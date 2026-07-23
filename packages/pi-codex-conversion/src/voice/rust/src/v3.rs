use std::sync::Arc;
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
use crate::protocol::{Event, MAX_DATA_MESSAGE_BYTES};
use crate::resample::LinearResampler;

const OPUS_RATE: u32 = 48_000;
const OPUS_FRAME_SAMPLES: usize = 960;

pub struct V3Session {
    peer: Arc<RTCPeerConnection>,
    data_channel: Arc<RTCDataChannel>,
    capture_task: tokio::task::JoinHandle<()>,
    _capture: Capture,
    _playback: Playback,
}

impl V3Session {
    pub async fn create(
        microphone: Option<&str>,
        speaker: Option<&str>,
        events: mpsc::Sender<Event>,
    ) -> Result<(Self, String)> {
        let capture = audio::capture(microphone)?;
        let playback = audio::playback(speaker)?;
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
        let capture_task = tokio::spawn(async move {
            let mut buffer = vec![0_u8; 1500];
            while sender.read(&mut buffer).await.is_ok() {}
        });

        let data_channel = peer.create_data_channel("oai-events", None).await?;
        let open_events = events.clone();
        data_channel.on_open(Box::new(move || {
            let open_events = open_events.clone();
            Box::pin(async move {
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

        let playback_queue = Arc::clone(&playback.samples);
        let playback_rate = playback.sample_rate;
        peer.on_track(Box::new(move |remote, _, _| {
            let playback_queue = Arc::clone(&playback_queue);
            Box::pin(async move {
                let Ok(mut decoder) = opus::Decoder::new(OPUS_RATE, opus::Channels::Stereo) else {
                    return;
                };
                let Ok(mut resampler) = LinearResampler::new(OPUS_RATE, playback_rate) else {
                    return;
                };
                let mut decoded = vec![0_f32; OPUS_FRAME_SAMPLES * 2 * 6];
                while let Ok((packet, _)) = remote.read_rtp().await {
                    let Ok(samples_per_channel) =
                        decoder.decode_float(&packet.payload, &mut decoded, false)
                    else {
                        continue;
                    };
                    let mut mono = Vec::with_capacity(samples_per_channel);
                    for pair in decoded[..samples_per_channel * 2].chunks_exact(2) {
                        mono.push((pair[0] + pair[1]) * 0.5);
                    }
                    let mut converted = Vec::new();
                    resampler.process(&mono, &mut converted);
                    for sample in converted {
                        let _ = playback_queue.push(sample);
                    }
                }
            })
        }));

        let capture_queue = Arc::clone(&capture.samples);
        let capture_rate = capture.sample_rate;
        tokio::spawn(async move {
            let mut encoder = match opus::Encoder::new(
                OPUS_RATE,
                opus::Channels::Mono,
                opus::Application::Voip,
            ) {
                Ok(value) => value,
                Err(_) => return,
            };
            let mut resampler = match LinearResampler::new(capture_rate, OPUS_RATE) {
                Ok(value) => value,
                Err(_) => return,
            };
            let mut pending = Vec::new();
            let mut source = Vec::new();
            let mut packet = vec![0_u8; 4_000];
            let mut ticker = tokio::time::interval(Duration::from_millis(10));
            loop {
                ticker.tick().await;
                source.clear();
                audio::drain(&capture_queue, capture_rate as usize / 50, &mut source);
                resampler.process(&source, &mut pending);
                while pending.len() >= OPUS_FRAME_SAMPLES {
                    let frame: Vec<f32> = pending.drain(..OPUS_FRAME_SAMPLES).collect();
                    let Ok(size) = encoder.encode_float(&frame, &mut packet) else {
                        return;
                    };
                    if track
                        .write_sample(&MediaSample {
                            data: Bytes::copy_from_slice(&packet[..size]),
                            duration: Duration::from_millis(20),
                            ..Default::default()
                        })
                        .await
                        .is_err()
                    {
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
                capture_task,
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

    pub async fn close(self) -> Result<()> {
        self.capture_task.abort();
        let _ = self.capture_task.await;
        self.peer.close().await?;
        Ok(())
    }
}
