use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::Result;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bytes::Bytes;
use crossbeam_queue::ArrayQueue;
use tokio::sync::mpsc;
use tokio::time::Instant;
use webrtc::api::media_engine::MIME_TYPE_OPUS;
use webrtc::media::Sample as MediaSample;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use crate::audio;
use crate::playout::{PacketPlayout, PlayoutClock, PlayoutFrame};
use crate::protocol::Event;
use crate::resample::LinearResampler;

const OPUS_RATE: u32 = 48_000;
const OPUS_FRAME_SAMPLES: usize = 960;
pub const BRIDGE_RATE: u32 = 24_000;
const BRIDGE_FRAME_SAMPLES: usize = 480;

#[derive(Clone)]
pub enum OutputSink {
    Device {
        samples: Arc<ArrayQueue<f32>>,
        sample_rate: u32,
    },
    Bridge,
}

impl OutputSink {
    fn sample_rate(&self) -> u32 {
        match self {
            Self::Device { sample_rate, .. } => *sample_rate,
            Self::Bridge => BRIDGE_RATE,
        }
    }
}

pub async fn create_audio_sender(
    peer: &Arc<RTCPeerConnection>,
) -> Result<(Arc<TrackLocalStaticSample>, tokio::task::JoinHandle<()>)> {
    let track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_OPUS.to_owned(),
            clock_rate: OPUS_RATE,
            channels: 2,
            ..Default::default()
        },
        "audio".to_owned(),
        "pi".to_owned(),
    ));
    let sender = peer
        .add_track(Arc::clone(&track) as Arc<dyn TrackLocal + Send + Sync>)
        .await?;
    let rtcp_task = tokio::spawn(async move {
        let mut buffer = vec![0_u8; 1500];
        while sender.read(&mut buffer).await.is_ok() {}
    });
    Ok((track, rtcp_task))
}

pub fn register_playout(
    peer: &Arc<RTCPeerConnection>,
    output: OutputSink,
    events: mpsc::Sender<Event>,
) {
    let output_rate = output.sample_rate();
    peer.on_track(Box::new(move |remote, _, _| {
        let output = output.clone();
        let output_events = events.clone();
        Box::pin(async move {
            let mut decoder = match opus::Decoder::new(OPUS_RATE, opus::Channels::Stereo) {
                Ok(decoder) => decoder,
                Err(error) => {
                    let _ = output_events
                        .send(Event::Error {
                            message: format!("could not start realtime audio decoder: {error}"),
                        })
                        .await;
                    return;
                }
            };
            let mut resampler = match LinearResampler::new(OPUS_RATE, output_rate) {
                Ok(resampler) => resampler,
                Err(error) => {
                    let _ = output_events
                        .send(Event::Error {
                            message: error.to_string(),
                        })
                        .await;
                    return;
                }
            };
            let mut playout = PacketPlayout::new();
            let mut playout_clock = PlayoutClock::new();
            let mut decoded = vec![0_f32; OPUS_FRAME_SAMPLES * 2 * 6];
            let mut converted = Vec::new();
            let mut bridge_pending = Vec::new();
            let mut last_frame_samples = OPUS_FRAME_SAMPLES;
            loop {
                tokio::select! {
                    packet = remote.read_rtp() => {
                        let (packet, _) = match packet {
                            Ok(packet) => packet,
                            Err(error) => {
                                let _ = output_events.send(Event::Error { message: format!("realtime speaker stream ended: {error}") }).await;
                                return;
                            }
                        };
                        playout.push(packet.header.sequence_number, packet.payload);
                        if playout.ready() {
                            playout_clock.start(Instant::now());
                        }
                    }
                    _ = wait_for_playout(playout_clock.deadline()) => {
                        let frame = playout.next();
                        let (payload, decoded_output) = match frame {
                            PlayoutFrame::Buffering => {
                                playout_clock.stop();
                                continue;
                            }
                            PlayoutFrame::Packet(payload) => (payload, &mut decoded[..]),
                            PlayoutFrame::Missing => (Bytes::new(), &mut decoded[..last_frame_samples * 2]),
                        };
                        let Ok(samples_per_channel) = decoder.decode_float(&payload, decoded_output, false) else {
                            playout_clock.advance(last_frame_samples, OPUS_RATE);
                            continue;
                        };
                        last_frame_samples = samples_per_channel;
                        playout_clock.advance(samples_per_channel, OPUS_RATE);
                        let mut mono = Vec::with_capacity(samples_per_channel);
                        for pair in decoded[..samples_per_channel * 2].chunks_exact(2) {
                            mono.push((pair[0] + pair[1]) * 0.5);
                        }
                        converted.clear();
                        resampler.process(&mono, &mut converted);
                        match &output {
                            OutputSink::Device { samples, .. } => {
                                for sample in &converted {
                                    audio::push_latest(samples, *sample);
                                }
                            }
                            OutputSink::Bridge => {
                                bridge_pending.extend_from_slice(&converted);
                                while bridge_pending.len() >= BRIDGE_FRAME_SAMPLES {
                                    let frame: Vec<f32> = bridge_pending.drain(..BRIDGE_FRAME_SAMPLES).collect();
                                    let mut bytes = Vec::with_capacity(BRIDGE_FRAME_SAMPLES * 2);
                                    for sample in frame {
                                        bytes.extend_from_slice(&((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes());
                                    }
                                    if output_events.send(Event::Pcm {
                                        audio: BASE64.encode(bytes),
                                        sample_rate: BRIDGE_RATE,
                                        num_channels: 1,
                                    }).await.is_err() {
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
    }));
}

pub fn spawn_encoder(
    track: Arc<TrackLocalStaticSample>,
    samples: Arc<ArrayQueue<f32>>,
    input_rate: u32,
    enabled: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    events: mpsc::Sender<Event>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut encoder =
            match opus::Encoder::new(OPUS_RATE, opus::Channels::Mono, opus::Application::Voip) {
                Ok(value) => value,
                Err(error) => {
                    let _ = events
                        .send(Event::Error {
                            message: format!("could not start realtime audio encoder: {error}"),
                        })
                        .await;
                    return;
                }
            };
        let mut resampler = match LinearResampler::new(input_rate, OPUS_RATE) {
            Ok(value) => value,
            Err(error) => {
                let _ = events
                    .send(Event::Error {
                        message: error.to_string(),
                    })
                    .await;
                return;
            }
        };
        let mut pending = Vec::new();
        let mut source = Vec::new();
        let mut packet = vec![0_u8; 4_000];
        let mut was_muted = false;
        let mut ticker = tokio::time::interval(Duration::from_millis(20));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            if !enabled.load(Ordering::Acquire) {
                continue;
            }
            source.clear();
            audio::drain(&samples, input_rate as usize / 50, &mut source);
            if muted.load(Ordering::Relaxed) {
                pending.clear();
                if !was_muted {
                    resampler.reset();
                    was_muted = true;
                }
                pending.resize(OPUS_FRAME_SAMPLES, 0.0);
            } else {
                was_muted = false;
                resampler.process(&source, &mut pending);
            }
            while pending.len() >= OPUS_FRAME_SAMPLES {
                let frame: Vec<f32> = pending.drain(..OPUS_FRAME_SAMPLES).collect();
                let size = match encoder.encode_float(&frame, &mut packet) {
                    Ok(size) => size,
                    Err(error) => {
                        let _ = events
                            .send(Event::Error {
                                message: format!("realtime microphone encoder failed: {error}"),
                            })
                            .await;
                        return;
                    }
                };
                if let Err(error) = track
                    .write_sample(&MediaSample {
                        data: Bytes::copy_from_slice(&packet[..size]),
                        duration: Duration::from_millis(20),
                        ..Default::default()
                    })
                    .await
                {
                    let _ = events
                        .send(Event::Error {
                            message: format!("realtime microphone stream failed: {error}"),
                        })
                        .await;
                    return;
                }
            }
        }
    })
}

async fn wait_for_playout(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}
