use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use bytes::Bytes;
use crossbeam_queue::ArrayQueue;
use tokio::sync::{mpsc, oneshot};
use webrtc::media::Sample as MediaSample;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use super::{
    BRIDGE_RATE, OPUS_FRAME_SAMPLES, OPUS_RATE, report_terminal_error, with_send_deadline,
};
use crate::audio::{self, SpeakerState};
use crate::codex_audio::buffers::Frame;
use crate::codex_audio::processing::{self, EncodedAudio, Processor};
use crate::protocol::Event;
use crate::resample::LinearResampler;

struct InputTransition {
    generation: u64,
    done: oneshot::Sender<()>,
}

pub(crate) struct InputControl {
    generation: Arc<AtomicU64>,
    transitions: mpsc::Sender<InputTransition>,
}

pub(crate) struct DeviceEncoder {
    pub(crate) frames: Arc<ArrayQueue<Frame>>,
    pub(crate) input_rate: u32,
    pub(crate) generation: Arc<AtomicU64>,
    pub(crate) dropped: Arc<AtomicBool>,
    pub(crate) failed: Arc<AtomicBool>,
    pub(crate) rendered: Arc<ArrayQueue<Frame>>,
    pub(crate) output_rate: u32,
    pub(crate) render_dropped: Arc<AtomicBool>,
    pub(crate) speaker: Arc<SpeakerState>,
}

impl InputControl {
    pub(crate) async fn set_muted(&self, muted: bool) -> Result<()> {
        let current = self.generation.load(Ordering::Acquire);
        if (current % 2 == 1) == muted {
            return Ok(());
        }
        let next = current
            .checked_add(1)
            .context("microphone generation exhausted")?;
        self.generation.store(next, Ordering::Release);
        let (done, completed) = oneshot::channel();
        self.transitions
            .send(InputTransition {
                generation: next,
                done,
            })
            .await
            .context("realtime microphone worker stopped")?;
        completed
            .await
            .context("realtime microphone transition was not applied")
    }

    pub(crate) fn muted(&self) -> bool {
        self.generation.load(Ordering::Acquire) % 2 == 1
    }
}

pub(crate) fn spawn_device_encoder(
    track: Arc<TrackLocalStaticSample>,
    device: DeviceEncoder,
    enabled: Arc<AtomicBool>,
    events: mpsc::Sender<Event>,
) -> (InputControl, tokio::task::JoinHandle<()>) {
    let DeviceEncoder {
        frames,
        input_rate,
        generation,
        dropped,
        failed,
        rendered,
        output_rate,
        render_dropped,
        speaker,
    } = device;
    let (transitions, mut transition_rx) = mpsc::channel::<InputTransition>(4);
    let input = InputControl {
        generation: Arc::clone(&generation),
        transitions,
    };
    let task = tokio::spawn(async move {
        let mut processor = match Processor::new(input_rate, output_rate) {
            Ok(processor) => processor,
            Err(error) => {
                report_terminal_error(&events, error).await;
                return;
            }
        };
        let mut pending = VecDeque::<(u64, EncodedAudio)>::new();
        let mut ticker = tokio::time::interval(Duration::from_millis(20));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut was_enabled = false;
        let mut speaker_epoch = speaker.get().epoch;
        loop {
            tokio::select! {
                biased;
                Some(transition) = transition_rx.recv() => {
                    if transition.generation != generation.load(Ordering::Acquire) {
                        report_terminal_error(&events, "microphone transition generation mismatch").await;
                        return;
                    }
                    audio::clear(&frames);
                    pending.clear();
                    if let Err(error) = processor.reset() {
                        report_terminal_error(&events, error).await;
                        return;
                    }
                    let _ = transition.done.send(());
                }
                _ = ticker.tick() => {
                    if failed.load(Ordering::Acquire) {
                        report_terminal_error(&events, "microphone stream failed").await;
                        return;
                    }
                    let active_speaker = speaker.get();
                    if active_speaker.epoch != speaker_epoch {
                        speaker_epoch = active_speaker.epoch;
                        processor.reset_render();
                        audio::clear(&rendered);
                    }
                    if render_dropped.swap(false, Ordering::AcqRel) {
                        processor.reset_render();
                        audio::clear(&rendered);
                    }
                    for _ in 0..rendered.capacity() {
                        let Some(frame) = rendered.pop() else {
                            break;
                        };
                        if frame.generation == speaker_epoch
                            && processor.render(&frame).is_err()
                        {
                            report_terminal_error(&events, "voice echo reference failed").await;
                            return;
                        }
                    }
                    let is_enabled = enabled.load(Ordering::Acquire);
                    if !is_enabled {
                        audio::clear(&frames);
                        pending.clear();
                        if was_enabled && processor.reset().is_err() {
                            report_terminal_error(&events, "failed to reset voice processing").await;
                            return;
                        }
                        was_enabled = false;
                        continue;
                    }
                    was_enabled = true;
                    let current = generation.load(Ordering::Acquire);
                    if current % 2 == 1 {
                        audio::clear(&frames);
                        pending.clear();
                        let silence = match processor.silence(Instant::now()) {
                            Ok(silence) => silence,
                            Err(error) => {
                                report_terminal_error(&events, error).await;
                                return;
                            }
                        };
                        if write_encoded(&track, silence, &events).await.is_err() {
                            return;
                        }
                        continue;
                    }
                    if dropped.swap(false, Ordering::AcqRel) {
                        audio::clear(&frames);
                        pending.clear();
                        if let Err(error) = processor.reset() {
                            report_terminal_error(&events, error).await;
                            return;
                        }
                    }
                    if pending.is_empty() {
                        for _ in 0..frames.capacity() {
                            let Some(frame) = frames.pop() else {
                                break;
                            };
                            if frame.generation != current {
                                continue;
                            }
                            match processor.capture(&frame, Instant::now) {
                                Ok(encoded) => {
                                    pending.extend(encoded.into_iter().map(|audio| (current, audio)));
                                }
                                Err(processing::PROCESSING_LATE) => {
                                    pending.clear();
                                    if let Err(error) = processor.reset() {
                                        report_terminal_error(&events, error).await;
                                        return;
                                    }
                                }
                                Err(error) => {
                                    report_terminal_error(&events, error).await;
                                    return;
                                }
                            }
                        }
                    }
                    let Some((packet_generation, packet)) = pending.pop_front() else {
                        continue;
                    };
                    if packet_generation != generation.load(Ordering::Acquire) {
                        pending.clear();
                        continue;
                    }
                    if Instant::now().saturating_duration_since(packet.at)
                        > processing::MAX_PROCESSING_DELAY
                    {
                        pending.clear();
                        if let Err(error) = processor.reset() {
                            report_terminal_error(&events, error).await;
                            return;
                        }
                        continue;
                    }
                    if write_encoded(&track, packet, &events).await.is_err() {
                        return;
                    }
                }
            }
        }
    });
    (input, task)
}

pub(crate) fn spawn_bridge_encoder(
    track: Arc<TrackLocalStaticSample>,
    samples: Arc<ArrayQueue<f32>>,
    generation: Arc<AtomicU64>,
    enabled: Arc<AtomicBool>,
    events: mpsc::Sender<Event>,
) -> (InputControl, tokio::task::JoinHandle<()>) {
    let (transitions, mut transition_rx) = mpsc::channel::<InputTransition>(4);
    let input = InputControl {
        generation: Arc::clone(&generation),
        transitions,
    };
    let task = tokio::spawn(async move {
        let mut encoder = match new_opus_encoder() {
            Ok(encoder) => encoder,
            Err(error) => {
                report_terminal_error(&events, &error.to_string()).await;
                return;
            }
        };
        let mut resampler = match LinearResampler::new(BRIDGE_RATE, OPUS_RATE) {
            Ok(resampler) => resampler,
            Err(error) => {
                report_terminal_error(&events, &error.to_string()).await;
                return;
            }
        };
        let mut pending = Vec::new();
        let mut source = Vec::new();
        let mut packet = vec![0_u8; 4_000];
        let mut ticker = tokio::time::interval(Duration::from_millis(20));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                biased;
                Some(transition) = transition_rx.recv() => {
                    if transition.generation != generation.load(Ordering::Acquire) {
                        report_terminal_error(&events, "microphone transition generation mismatch").await;
                        return;
                    }
                    audio::clear(&samples);
                    pending.clear();
                    resampler.reset();
                    match new_opus_encoder() {
                        Ok(replacement) => encoder = replacement,
                        Err(error) => {
                            report_terminal_error(&events, &error.to_string()).await;
                            return;
                        }
                    }
                    let _ = transition.done.send(());
                }
                _ = ticker.tick() => {
                    if !enabled.load(Ordering::Acquire) {
                        audio::clear(&samples);
                        pending.clear();
                        resampler.reset();
                        continue;
                    }
                    let current = generation.load(Ordering::Acquire);
                    source.clear();
                    audio::drain(&samples, BRIDGE_RATE as usize / 50, &mut source);
                    if current % 2 == 1 {
                        pending.clear();
                        pending.resize(OPUS_FRAME_SAMPLES, 0.0);
                    } else {
                        resampler.process(&source, &mut pending);
                    }
                    while pending.len() >= OPUS_FRAME_SAMPLES {
                        if current != generation.load(Ordering::Acquire) {
                            pending.clear();
                            break;
                        }
                        let frame: Vec<f32> = pending.drain(..OPUS_FRAME_SAMPLES).collect();
                        let size = match encoder.encode_float(&frame, &mut packet) {
                            Ok(size) => size,
                            Err(error) => {
                                report_terminal_error(
                                    &events,
                                    &format!("realtime microphone encoder failed: {error}"),
                                ).await;
                                return;
                            }
                        };
                        let encoded = EncodedAudio {
                            data: packet[..size].to_vec(),
                            at: Instant::now(),
                        };
                        if write_encoded(&track, encoded, &events).await.is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });
    (input, task)
}

fn new_opus_encoder() -> Result<opus::Encoder> {
    opus::Encoder::new(OPUS_RATE, opus::Channels::Mono, opus::Application::Voip)
        .context("could not start realtime audio encoder")
}

async fn write_encoded(
    track: &TrackLocalStaticSample,
    packet: EncodedAudio,
    events: &mpsc::Sender<Event>,
) -> Result<()> {
    let sample = MediaSample {
        data: Bytes::from(packet.data),
        duration: Duration::from_millis(20),
        ..Default::default()
    };
    let send = track.write_sample(&sample);
    let failure = match with_send_deadline(send).await {
        Ok(Ok(())) => return Ok(()),
        Ok(Err(error)) => format!("realtime microphone stream failed: {error}"),
        Err(_) => "realtime microphone stream stalled".to_owned(),
    };
    report_terminal_error(events, &failure).await;
    anyhow::bail!(failure)
}
