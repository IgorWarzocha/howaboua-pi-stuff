use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result};
use crossbeam_queue::ArrayQueue;
use serde_json::Value;
use tokio::sync::mpsc;
use webrtc::api::APIBuilder;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::data_channel::RTCDataChannel;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

use crate::audio::{self, Capture, Playback};
use crate::protocol::{Event, MAX_DATA_MESSAGE_BYTES};
use crate::v3_media::{
    BRIDGE_RATE, OutputSink, create_audio_sender, register_playout, spawn_encoder,
};

const BRIDGE_INPUT_SECONDS: usize = 3;

pub struct V3Session {
    peer: Arc<RTCPeerConnection>,
    data_channel: Arc<RTCDataChannel>,
    rtcp_task: tokio::task::JoinHandle<()>,
    encoder_task: tokio::task::JoinHandle<()>,
    input_muted: Arc<AtomicBool>,
    _capture: Option<Capture>,
    _playback: Option<Playback>,
    bridge_input: Option<Arc<ArrayQueue<f32>>>,
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
        let output = OutputSink::Device {
            samples: Arc::clone(&playback.samples),
            sample_rate: playback.sample_rate,
        };
        Self::create(
            input_samples,
            input_rate,
            output,
            events,
            Some(capture),
            Some(playback),
            None,
        )
        .await
    }

    pub async fn create_bridge(events: mpsc::Sender<Event>) -> Result<(Self, String)> {
        let input = Arc::new(ArrayQueue::new(BRIDGE_RATE as usize * BRIDGE_INPUT_SECONDS));
        Self::create(
            Arc::clone(&input),
            BRIDGE_RATE,
            OutputSink::Bridge,
            events,
            None,
            None,
            Some(input),
        )
        .await
    }

    async fn create(
        input_samples: Arc<ArrayQueue<f32>>,
        input_rate: u32,
        output: OutputSink,
        events: mpsc::Sender<Event>,
        capture: Option<Capture>,
        playback: Option<Playback>,
        bridge_input: Option<Arc<ArrayQueue<f32>>>,
    ) -> Result<(Self, String)> {
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;
        let registry = register_default_interceptors(Registry::new(), &mut media_engine)?;
        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .build();
        let peer = Arc::new(api.new_peer_connection(RTCConfiguration::default()).await?);

        let (track, rtcp_task) = create_audio_sender(&peer).await?;

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

        register_playout(&peer, output, events.clone());
        let input_muted = Arc::new(AtomicBool::new(false));
        let encoder_task = spawn_encoder(
            track,
            input_samples,
            input_rate,
            input_enabled,
            Arc::clone(&input_muted),
            events,
        );

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
                bridge_input,
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

    pub fn send_pcm(&self, pcm: &[u8]) -> Result<()> {
        let input = self
            .bridge_input
            .as_ref()
            .context("PCM input requires a bridge V3 session")?;
        if pcm.len() % 2 != 0 {
            anyhow::bail!("bridge PCM must contain complete i16 samples");
        }
        for bytes in pcm.chunks_exact(2) {
            let sample = i16::from_le_bytes([bytes[0], bytes[1]]);
            let normalized = sample as f32 / if sample < 0 { 32_768.0 } else { 32_767.0 };
            audio::push_latest(input, normalized);
        }
        Ok(())
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
