use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;
use tokio::sync::{Mutex, mpsc, watch};
use tokio::task::JoinSet;
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::media_stream::track_remote::TrackRemote;
use webrtc::peer_connection::{
    PeerConnectionEventHandler, RTCIceGatheringState, RTCPeerConnectionState,
};

use crate::audio::{SpeakerControl, SpeakerState};
use crate::protocol::{Event, MAX_DATA_MESSAGE_BYTES};
use crate::v3_media::{OutputSink, play_remote_track};

pub(super) struct PeerEvents {
    pub events: mpsc::Sender<Event>,
    pub gather_tx: mpsc::Sender<()>,
    pub output: OutputSink,
    pub speaker: Arc<SpeakerState>,
    pub controls: watch::Receiver<SpeakerControl>,
    pub workers: Arc<Mutex<JoinSet<()>>>,
    pub closing: Arc<AtomicBool>,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for PeerEvents {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            let _ = self.gather_tx.try_send(());
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        let state = match state {
            RTCPeerConnectionState::Connected => "connected",
            RTCPeerConnectionState::Disconnected => "disconnected",
            RTCPeerConnectionState::Failed => "failed",
            RTCPeerConnectionState::Closed => "closed",
            _ => return,
        };
        let _ = self.events.send(Event::State { state }).await;
    }

    async fn on_track(&self, remote: Arc<dyn TrackRemote>) {
        // The callback runs on the peer driver: never await track I/O here.
        let mut workers = self.workers.lock().await;
        if self.closing.load(Ordering::Acquire) {
            return;
        }
        while workers.try_join_next().is_some() {}
        workers.spawn(play_remote_track(
            remote,
            self.output.clone(),
            self.events.clone(),
            Arc::clone(&self.speaker),
            self.controls.clone(),
        ));
    }
}

pub(super) async fn receive_data(
    channel: Arc<dyn DataChannel>,
    enabled: Arc<AtomicBool>,
    events: mpsc::Sender<Event>,
) {
    while let Some(event) = channel.poll().await {
        match event {
            DataChannelEvent::OnOpen => {
                enabled.store(true, Ordering::Release);
                let _ = events.send(Event::State { state: "ready" }).await;
            }
            DataChannelEvent::OnMessage(message) => {
                if message.data.len() > MAX_DATA_MESSAGE_BYTES {
                    let _ = events.send(Event::Error {
                        message: format!("Realtime voice event exceeded the {MAX_DATA_MESSAGE_BYTES}-byte safety limit; the complete voice request could not be received. Restart voice and try a shorter request."),
                    }).await;
                    break;
                }
                let event = match serde_json::from_slice::<Value>(&message.data) {
                    Ok(message) => Event::Data { message },
                    Err(error) => Event::Error {
                        message: format!("invalid realtime data event: {error}"),
                    },
                };
                if events.send(event).await.is_err() {
                    break;
                }
            }
            DataChannelEvent::OnClose => break,
            _ => {}
        }
    }
    enabled.store(false, Ordering::Release);
}
