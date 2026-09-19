use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant as StdInstant};

use anyhow::Result;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bytes::Bytes;
use crossbeam_queue::ArrayQueue;
use tokio::sync::{mpsc, watch};
use tokio::time::Instant;
use webrtc::api::media_engine::MIME_TYPE_OPUS;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use crate::audio::{self, PlaybackSample, SpeakerControl, SpeakerState};
use crate::playout::{PacketPlayout, PlayoutClock, PlayoutFrame};
use crate::protocol::Event;
use crate::resample::LinearResampler;

#[path = "v3_capture.rs"]
mod capture;
pub(crate) use capture::{DeviceEncoder, InputControl, spawn_bridge_encoder, spawn_device_encoder};

pub(super) const OPUS_RATE: u32 = 48_000;
pub(super) const OPUS_FRAME_SAMPLES: usize = 960;
pub const BRIDGE_RATE: u32 = 24_000;
const BRIDGE_FRAME_SAMPLES: usize = 480;
const ACTIVITY_INTERVAL: Duration = Duration::from_millis(100);
const ACTIVITY_THRESHOLD: f32 = 0.0001;
const SEND_TIMEOUT: Duration = Duration::from_millis(100);
pub(crate) const TRANSITION_DRAIN_PACKET_BUDGET: usize = 256;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReadyDrain<E> {
    Pending,
    ReadFailed(E),
    Exhausted,
}

pub(crate) fn drain_ready_packets<F, T, E, N>(read: &mut Pin<Box<F>>, mut next: N) -> ReadyDrain<E>
where
    F: Future<Output = std::result::Result<T, E>>,
    N: FnMut() -> Pin<Box<F>>,
{
    for _ in 0..TRANSITION_DRAIN_PACKET_BUDGET {
        match poll_once(read.as_mut()) {
            Poll::Ready(Ok(_)) => *read = next(),
            Poll::Ready(Err(error)) => return ReadyDrain::ReadFailed(error),
            Poll::Pending => return ReadyDrain::Pending,
        }
    }
    match poll_once(read.as_mut()) {
        Poll::Ready(Ok(_)) => ReadyDrain::Exhausted,
        Poll::Ready(Err(error)) => ReadyDrain::ReadFailed(error),
        Poll::Pending => ReadyDrain::Pending,
    }
}

fn poll_once<F: Future + ?Sized>(read: Pin<&mut F>) -> Poll<F::Output> {
    let mut context = Context::from_waker(Waker::noop());
    read.poll(&mut context)
}

pub(crate) async fn with_send_deadline<F: Future>(
    send: F,
) -> Result<F::Output, tokio::time::error::Elapsed> {
    tokio::time::timeout(SEND_TIMEOUT, send).await
}

pub(crate) async fn report_terminal_error(events: &mpsc::Sender<Event>, message: &str) {
    let delivered = with_send_deadline(events.send(Event::Error {
        message: message.to_owned(),
    }))
    .await;
    if !matches!(delivered, Ok(Ok(()))) {
        eprintln!("voice helper could not report terminal error: {message}");
        std::process::exit(1);
    }
}

#[derive(Clone)]
pub enum OutputSink {
    Device {
        samples: Arc<ArrayQueue<PlaybackSample>>,
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
    speaker: Arc<SpeakerState>,
    controls: watch::Receiver<SpeakerControl>,
) {
    let output_rate = output.sample_rate();
    peer.on_track(Box::new(move |remote, _, _| {
        let output = output.clone();
        let output_events = events.clone();
        let speaker = Arc::clone(&speaker);
        let mut controls = controls.clone();
        Box::pin(async move {
            let mut decoder = match opus::Decoder::new(OPUS_RATE, opus::Channels::Stereo) {
                Ok(decoder) => decoder,
                Err(error) => {
                    report_terminal_error(
                        &output_events,
                        &format!("could not start realtime audio decoder: {error}"),
                    )
                    .await;
                    return;
                }
            };
            let mut resampler = match LinearResampler::new(OPUS_RATE, output_rate) {
                Ok(resampler) => resampler,
                Err(error) => {
                    report_terminal_error(&output_events, &error.to_string()).await;
                    return;
                }
            };
            let mut control = *controls.borrow_and_update();
            let mut playout = PacketPlayout::new();
            let mut playout_clock = PlayoutClock::new();
            let mut decoded = vec![0_f32; OPUS_FRAME_SAMPLES * 2 * 6];
            let mut converted = Vec::new();
            let mut bridge_pending = Vec::new();
            let mut last_frame_samples = OPUS_FRAME_SAMPLES;
            let mut last_activity = None;
            // TrackRemote::read is not cancellation-safe. Keep one read alive
            // across every select and transition-boundary readiness probe.
            let mut packet_read = Box::pin(remote.read_rtp());
            loop {
                tokio::select! {
                    biased;
                    changed = controls.changed() => {
                        if changed.is_err() {
                            return;
                        }
                        // webrtc 0.17 exposes no packet arrival metadata. Discard each
                        // packet that is already readable while the old epoch is still
                        // installed, then apply the new epoch only once the read is pending.
                        match drain_ready_packets(&mut packet_read, || Box::pin(remote.read_rtp())) {
                            ReadyDrain::Pending => {}
                            ReadyDrain::ReadFailed(error) => {
                                report_terminal_error(
                                    &output_events,
                                    &format!("realtime speaker stream ended: {error}"),
                                ).await;
                                return;
                            }
                            ReadyDrain::Exhausted => {
                                report_terminal_error(
                                    &output_events,
                                    "realtime speaker transition queue did not quiesce",
                                ).await;
                                return;
                            }
                        }
                        control = *controls.borrow_and_update();
                        playout.reset();
                        playout_clock.stop();
                        resampler.reset();
                        bridge_pending.clear();
                        last_frame_samples = OPUS_FRAME_SAMPLES;
                        match opus::Decoder::new(OPUS_RATE, opus::Channels::Stereo) {
                            Ok(replacement) => decoder = replacement,
                            Err(error) => {
                                report_terminal_error(
                                    &output_events,
                                    &format!("could not reset realtime audio decoder: {error}"),
                                ).await;
                                return;
                            }
                        }
                    }
                    packet = &mut packet_read => {
                        let (packet, _) = match packet {
                            Ok(packet) => packet,
                            Err(error) => {
                                report_terminal_error(
                                    &output_events,
                                    &format!("realtime speaker stream ended: {error}"),
                                ).await;
                                return;
                            }
                        };
                        packet_read = Box::pin(remote.read_rtp());
                        if control.accepts_packet(speaker.get()) {
                            playout.push(packet.header.sequence_number, packet.payload);
                            if playout.ready() {
                                playout_clock.start(Instant::now());
                            }
                        }
                    }
                    _ = wait_for_playout(playout_clock.deadline()) => {
                        if control.suppressed || speaker.get() != control {
                            playout.reset();
                            playout_clock.stop();
                            bridge_pending.clear();
                            continue;
                        }
                        let frame = playout.next();
                        let (payload, decoded_output) = match frame {
                            PlayoutFrame::Buffering => {
                                playout_clock.stop();
                                continue;
                            }
                            PlayoutFrame::Packet(payload) => (payload, &mut decoded[..]),
                            PlayoutFrame::Missing => {
                                (Bytes::new(), &mut decoded[..last_frame_samples * 2])
                            }
                        };
                        let Ok(samples_per_channel) =
                            decoder.decode_float(&payload, decoded_output, false)
                        else {
                            playout_clock.advance(last_frame_samples, OPUS_RATE);
                            continue;
                        };
                        last_frame_samples = samples_per_channel;
                        playout_clock.advance(samples_per_channel, OPUS_RATE);
                        let mut mono = Vec::with_capacity(samples_per_channel);
                        for pair in decoded[..samples_per_channel * 2].as_chunks::<2>().0 {
                            mono.push((pair[0] + pair[1]) * 0.5);
                        }
                        converted.clear();
                        resampler.process(&mono, &mut converted);
                        if !control.accepts_packet(speaker.get()) {
                            playout.reset();
                            playout_clock.stop();
                            bridge_pending.clear();
                            continue;
                        }
                        match &output {
                            OutputSink::Device { samples, .. } => {
                                for sample in &converted {
                                    audio::push_latest(
                                        samples,
                                        PlaybackSample {
                                            value: *sample,
                                            epoch: control.epoch,
                                        },
                                    );
                                }
                            }
                            OutputSink::Bridge => {
                                bridge_pending.extend_from_slice(&converted);
                                while bridge_pending.len() >= BRIDGE_FRAME_SAMPLES {
                                    let frame: Vec<f32> =
                                        bridge_pending.drain(..BRIDGE_FRAME_SAMPLES).collect();
                                    let active =
                                        frame.iter().any(|sample| sample.abs() >= ACTIVITY_THRESHOLD);
                                    let mut bytes = Vec::with_capacity(BRIDGE_FRAME_SAMPLES * 2);
                                    for sample in frame {
                                        bytes.extend_from_slice(
                                            &((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                                                .to_le_bytes(),
                                        );
                                    }
                                    if active {
                                        let now = StdInstant::now();
                                        if last_activity.is_none_or(|last| {
                                            now.duration_since(last) >= ACTIVITY_INTERVAL
                                        }) && output_events
                                            .try_send(Event::PlaybackActivity)
                                            .is_ok()
                                        {
                                            last_activity = Some(now);
                                        }
                                    }
                                    if output_events
                                        .send(Event::Pcm {
                                            audio: BASE64.encode(bytes),
                                            sample_rate: BRIDGE_RATE,
                                            num_channels: 1,
                                            epoch: Some(control.epoch),
                                        })
                                        .await
                                        .is_err()
                                    {
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

async fn wait_for_playout(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}
