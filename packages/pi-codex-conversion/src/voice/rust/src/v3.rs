use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use bytes::Bytes;
use serde_json::Value;
use tokio::sync::mpsc;
use webrtc::api::APIBuilder;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MIME_TYPE_OPUS, MediaEngine};
use webrtc::data_channel::RTCDataChannel;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::interceptor::registry::Registry;
use webrtc::media::Sample as MediaSample;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use crate::audio::{self, Capture, Playback};
use crate::playout::{PacketPlayout, PlayoutFrame};
use crate::protocol::{Event, MAX_DATA_MESSAGE_BYTES};
use crate::resample::LinearResampler;

const OPUS_RATE: u32 = 48_000;
const OPUS_FRAME_SAMPLES: usize = 960;

pub struct V3Session {
    peer: Arc<RTCPeerConnection>,
    data_channel: Arc<RTCDataChannel>,
    rtcp_task: tokio::task::JoinHandle<()>,
    encoder_task: tokio::task::JoinHandle<()>,
    input_muted: Arc<AtomicBool>,
    _capture: Capture,
    _playback: Playback,
}

impl V3Session {
    pub async fn create_devices(
        microphone: Option<String>,
        speaker: Option<String>,
        events: mpsc::Sender<Event>,
    ) -> Result<(Self, String)> {
        let capture = audio::capture(microphone.as_deref())?;
        let playback = audio::playback(speaker.as_deref(), events.clone())?;
        let input_samples = Arc::clone(&capture.samples);
        let input_rate = capture.sample_rate;

        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;
        let registry = register_default_interceptors(Registry::new(), &mut media_engine)?;
        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .build();
        let peer = Arc::new(api.new_peer_connection(RTCConfiguration::default()).await?);

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

        let input_enabled = Arc::new(AtomicBool::new(false));
        let data_channel = peer.create_data_channel("oai-events", None).await?;
        let open_events = events.clone();
        let open_input = Arc::clone(&input_enabled);
        data_channel.on_open(Box::new(move || {
            let open_events = open_events.clone();
            let open_input = Arc::clone(&open_input);
            Box::pin(async move {
                open_input.store(true, Ordering::Release);
                let _ = open_events.send(Event::State { state: "ready" }).await;
            })
        }));
        let message_events = events.clone();
        data_channel.on_message(Box::new(move |message: DataChannelMessage| {
            let message_events = message_events.clone();
            Box::pin(async move {
                if message.data.len() > MAX_DATA_MESSAGE_BYTES {
                    return;
                }
                match serde_json::from_slice::<Value>(&message.data) {
                    Ok(message) => {
                        let _ = message_events.send(Event::Data { message }).await;
                    }
                    Err(error) => {
                        let _ = message_events
                            .send(Event::Error {
                                message: format!("invalid realtime data event: {error}"),
                            })
                            .await;
                    }
                }
            })
        }));
        let state_events = events.clone();
        peer.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
            let state_events = state_events.clone();
            Box::pin(async move {
                let state = match state {
                    RTCPeerConnectionState::Connected => Some("connected"),
                    RTCPeerConnectionState::Disconnected => Some("disconnected"),
                    RTCPeerConnectionState::Failed => Some("failed"),
                    RTCPeerConnectionState::Closed => Some("closed"),
                    _ => None,
                };
                if let Some(state) = state {
                    let _ = state_events.send(Event::State { state }).await;
                }
            })
        }));

        let output_samples = Arc::clone(&playback.samples);
        let output_rate = playback.sample_rate;
        let output_events = events.clone();
        peer.on_track(Box::new(move |remote, _, _| {
            let output_samples = Arc::clone(&output_samples);
            let output_events = output_events.clone();
            Box::pin(async move {
                let mut decoder = match opus::Decoder::new(OPUS_RATE, opus::Channels::Stereo) {
                    Ok(decoder) => decoder,
                    Err(error) => {
                        let _ = output_events.send(Event::Error { message: format!("could not start realtime audio decoder: {error}") }).await;
                        return;
                    }
                };
                let mut resampler = match LinearResampler::new(OPUS_RATE, output_rate) {
                    Ok(resampler) => resampler,
                    Err(error) => {
                        let _ = output_events.send(Event::Error { message: error.to_string() }).await;
                        return;
                    }
                };
                let mut playout = PacketPlayout::new();
				let mut ticker = tokio::time::interval(Duration::from_millis(10));
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                let mut decoded = vec![0_f32; OPUS_FRAME_SAMPLES * 2 * 6];
                let mut converted = Vec::new();
				let mut last_frame_samples = OPUS_FRAME_SAMPLES;
				let mut ticks_until_next = 0;
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
                        }
						_ = ticker.tick() => {
							if ticks_until_next > 0 {
								ticks_until_next -= 1;
								continue;
							}
                            let frame = playout.next();
                            let (payload, output) = match frame {
                                PlayoutFrame::Buffering => continue,
                                PlayoutFrame::Packet(payload) => (payload, &mut decoded[..]),
                                PlayoutFrame::Missing => (Bytes::new(), &mut decoded[..last_frame_samples * 2]),
                            };
                            let Ok(samples_per_channel) = decoder.decode_float(&payload, output, false) else { continue; };
							last_frame_samples = samples_per_channel;
							ticks_until_next = samples_per_channel.div_ceil(OPUS_FRAME_SAMPLES / 2).saturating_sub(1);
                            let mut mono = Vec::with_capacity(samples_per_channel);
                            for pair in decoded[..samples_per_channel * 2].chunks_exact(2) {
                                mono.push((pair[0] + pair[1]) * 0.5);
                            }
                            converted.clear();
                            resampler.process(&mono, &mut converted);
                            for sample in &converted {
                                audio::push_latest(&output_samples, *sample);
                            }
                        }
                    }
                }
            })
        }));

        let encoder_samples = Arc::clone(&input_samples);
        let input_muted = Arc::new(AtomicBool::new(false));
        let encoder_muted = Arc::clone(&input_muted);
        let encoder_enabled = Arc::clone(&input_enabled);
        let encoder_events = events;
        let encoder_task = tokio::spawn(async move {
            let mut encoder = match opus::Encoder::new(
                OPUS_RATE,
                opus::Channels::Mono,
                opus::Application::Voip,
            ) {
                Ok(value) => value,
                Err(error) => {
                    let _ = encoder_events
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
                    let _ = encoder_events
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
                if !encoder_enabled.load(Ordering::Acquire) {
                    continue;
                }
                source.clear();
                audio::drain(&encoder_samples, input_rate as usize / 50, &mut source);
                if encoder_muted.load(Ordering::Relaxed) {
                    pending.clear();
                    if !was_muted {
                        resampler.reset();
                        was_muted = true;
                    }
                    continue;
                }
                was_muted = false;
                resampler.process(&source, &mut pending);
                while pending.len() >= OPUS_FRAME_SAMPLES {
                    let frame: Vec<f32> = pending.drain(..OPUS_FRAME_SAMPLES).collect();
                    let size = match encoder.encode_float(&frame, &mut packet) {
                        Ok(size) => size,
                        Err(error) => {
                            let _ = encoder_events
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
                        let _ = encoder_events
                            .send(Event::Error {
                                message: format!("realtime microphone stream failed: {error}"),
                            })
                            .await;
                        return;
                    }
                }
            }
        });

        let offer = peer.create_offer(None).await?;
        let mut gather = peer.gathering_complete_promise().await;
        peer.set_local_description(offer).await?;
        gather.recv().await;
        let sdp = peer
            .local_description()
            .await
            .context("WebRTC offer was not created")?
            .sdp;
        Ok((
            Self {
                peer,
                data_channel,
                rtcp_task,
                encoder_task,
                input_muted,
                _capture: capture,
                _playback: playback,
            },
            sdp,
        ))
    }

    pub async fn apply_answer(&self, sdp: String) -> Result<()> {
        self.peer
            .set_remote_description(RTCSessionDescription::answer(sdp)?)
            .await?;
        Ok(())
    }

    pub async fn send(&self, message: Value) -> Result<()> {
        self.data_channel
            .send_text(serde_json::to_string(&message)?)
            .await?;
        Ok(())
    }

    pub fn set_input_muted(&self, muted: bool) {
        self.input_muted.store(muted, Ordering::Relaxed);
    }

    pub async fn close(self) -> Result<()> {
        self.rtcp_task.abort();
        self.encoder_task.abort();
        let _ = self.rtcp_task.await;
        let _ = self.encoder_task.await;
        self.peer.close().await?;
        Ok(())
    }
}
