use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use anyhow::{Context, Result};
use crossbeam_queue::ArrayQueue;
use serde_json::Value;
use tokio::sync::{Mutex, mpsc, watch};
use tokio::task::JoinSet;
use webrtc::data_channel::DataChannel;
use webrtc::peer_connection::{
    MediaEngine, PeerConnection, PeerConnectionBuilder, RTCSessionDescription, Registry,
    register_default_interceptors,
};

use crate::audio::{self, Capture, Playback, SpeakerState};
use crate::protocol::Event;
use crate::v3_media::{
    BRIDGE_RATE, DeviceEncoder, InputControl, OutputSink, create_audio_sender,
    spawn_bridge_encoder, spawn_device_encoder,
};

#[path = "v3_events.rs"]
mod peer_events;
use peer_events::{PeerEvents, receive_data};

const BRIDGE_INPUT_SECONDS: usize = 3;

pub struct V3Session {
    peer: Arc<dyn PeerConnection>,
    data_channel: Arc<dyn DataChannel>,
    workers: Arc<Mutex<JoinSet<()>>>,
    closing: Arc<AtomicBool>,
    encoder_task: tokio::task::JoinHandle<()>,
    input: InputControl,
    speaker: Arc<SpeakerState>,
    speaker_tx: watch::Sender<audio::SpeakerControl>,
    _capture: Option<Capture>,
    playback: Option<Playback>,
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
        let output = OutputSink::Device {
            samples: Arc::clone(&playback.samples),
            sample_rate: playback.sample_rate,
        };
        Self::create(output, events, Some(capture), Some(playback), None).await
    }

    pub async fn create_bridge(events: mpsc::Sender<Event>) -> Result<(Self, String)> {
        let input = Arc::new(ArrayQueue::new(BRIDGE_RATE as usize * BRIDGE_INPUT_SECONDS));
        Self::create(OutputSink::Bridge, events, None, None, Some(input)).await
    }

    async fn create(
        output: OutputSink,
        events: mpsc::Sender<Event>,
        capture: Option<Capture>,
        playback: Option<Playback>,
        bridge_input: Option<Arc<ArrayQueue<f32>>>,
    ) -> Result<(Self, String)> {
        let speaker = playback
            .as_ref()
            .map(|playback| Arc::clone(&playback.state))
            .unwrap_or_else(|| Arc::new(SpeakerState::new()));
        let (speaker_tx, speaker_rx) = watch::channel(speaker.get());
        let workers = Arc::new(Mutex::new(JoinSet::new()));
        let closing = Arc::new(AtomicBool::new(false));
        let (gather_tx, mut gather_rx) = mpsc::channel(1);
        let handler = Arc::new(PeerEvents {
            events: events.clone(),
            gather_tx,
            output,
            speaker: Arc::clone(&speaker),
            controls: speaker_rx,
            workers: Arc::clone(&workers),
            closing: Arc::clone(&closing),
        });
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;
        let registry = register_default_interceptors(Registry::new(), &mut media_engine)?;
        let peer: Arc<dyn PeerConnection> = Arc::new(
            PeerConnectionBuilder::new()
                .with_media_engine(media_engine)
                .with_interceptor_registry(registry)
                .with_handler(handler)
                .with_udp_addrs(vec!["0.0.0.0:0"])
                .build()
                .await?,
        );

        // No application workers start until offer creation succeeds.
        let setup: Result<_> = async {
            let track = create_audio_sender(&peer).await?;
            let data_channel = peer.create_data_channel("oai-events", None).await?;
            let offer = peer.create_offer(None).await?;
            peer.set_local_description(offer).await?;
            gather_rx
                .recv()
                .await
                .context("WebRTC ICE gathering stopped")?;
            let sdp = peer
                .local_description()
                .await
                .context("WebRTC offer was not created")?
                .sdp;
            Ok((track, data_channel, sdp))
        }
        .await;
        let (track, data_channel, sdp) = match setup {
            Ok(setup) => setup,
            Err(error) => {
                let _ = peer.close().await;
                return Err(error);
            }
        };
        let input_enabled = Arc::new(AtomicBool::new(false));
        workers.lock().await.spawn(receive_data(
            Arc::clone(&data_channel),
            Arc::clone(&input_enabled),
            events.clone(),
        ));

        let (input, encoder_task) = if let Some(capture) = &capture {
            let playback = playback
                .as_ref()
                .context("device capture requires device playback")?;
            spawn_device_encoder(
                track,
                DeviceEncoder {
                    frames: Arc::clone(&capture.frames),
                    input_rate: capture.sample_rate,
                    generation: Arc::clone(&capture.generation),
                    dropped: Arc::clone(&capture.dropped),
                    failed: Arc::clone(&capture.failed),
                    rendered: Arc::clone(&playback.rendered),
                    output_rate: playback.sample_rate,
                    render_dropped: Arc::clone(&playback.render_dropped),
                    speaker: Arc::clone(&speaker),
                },
                input_enabled,
                events,
            )
        } else {
            let bridge_input = bridge_input
                .as_ref()
                .context("bridge session requires PCM input")?;
            spawn_bridge_encoder(
                track,
                Arc::clone(bridge_input),
                Arc::new(AtomicU64::new(0)),
                input_enabled,
                events,
            )
        };

        Ok((
            Self {
                peer,
                data_channel,
                workers,
                closing,
                encoder_task,
                input,
                speaker,
                speaker_tx,
                _capture: capture,
                playback,
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
            .send_text(&serde_json::to_string(&message)?)
            .await?;
        Ok(())
    }

    pub async fn set_input_muted(&self, muted: bool) -> Result<()> {
        self.input.set_muted(muted).await
    }

    pub fn set_speaker_suppressed(&mut self, suppressed: bool, epoch: u64) -> Result<()> {
        if let Some(playback) = &mut self.playback {
            let result = playback.transition(suppressed, epoch);
            let current = self.speaker.get();
            if current.epoch == epoch {
                self.speaker_tx.send_replace(current);
            }
            result?;
        } else {
            let current = self.speaker.transition(suppressed, epoch)?;
            self.speaker_tx.send_replace(current);
        }
        Ok(())
    }

    pub fn send_pcm(&self, pcm: &[u8]) -> Result<()> {
        let input = self
            .bridge_input
            .as_ref()
            .context("PCM input requires a bridge V3 session")?;
        if !pcm.len().is_multiple_of(2) {
            anyhow::bail!("bridge PCM must contain complete i16 samples");
        }
        if self.input.muted() {
            return Ok(());
        }
        for bytes in pcm.as_chunks::<2>().0 {
            let sample = i16::from_le_bytes([bytes[0], bytes[1]]);
            let normalized = sample as f32 / if sample < 0 { 32_768.0 } else { 32_767.0 };
            audio::push_latest(input, normalized);
        }
        Ok(())
    }

    pub async fn close(self) -> Result<()> {
        self.closing.store(true, Ordering::Release);
        self.encoder_task.abort();
        let _ = self.encoder_task.await;
        // An orderly peer close ends remote tracks. Stop consumers first so
        // that lifecycle event cannot be reported as an audio failure.
        let mut workers = self.workers.lock().await;
        workers.abort_all();
        while workers.join_next().await.is_some() {}
        drop(workers);
        self.peer.close().await?;
        Ok(())
    }
}
