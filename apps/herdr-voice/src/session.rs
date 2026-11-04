use crate::{
    audio::{Audio, Frame},
    connection::{Connect, Connection, Provider},
    wire::Transport,
};
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::VecDeque, sync::Arc, time::Duration};
use tokio::sync::{RwLock, mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::Message;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Connecting,
    Listening,
    Muted,
    Error,
}

#[derive(Clone, Serialize)]
pub struct Status {
    pub phase: Phase,
    pub provider: Option<Provider>,
    pub url: Option<String>,
    pub muted: bool,
    pub error: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            phase: Phase::Idle,
            provider: None,
            url: None,
            muted: false,
            error: None,
        }
    }
}

pub type SharedStatus = Arc<RwLock<Status>>;
pub enum Command {
    Mute(bool, oneshot::Sender<Result<(), String>>),
}

pub async fn run(
    options: Connect,
    status: SharedStatus,
    mut cancel: watch::Receiver<Option<bool>>,
    mut commands: mpsc::Receiver<Command>,
) -> Result<()> {
    let result = execute(&options, &status, &mut cancel, &mut commands).await;
    let mut state = status.write().await;
    match &result {
        Ok(()) => *state = Status::default(),
        Err(error) => {
            state.phase = Phase::Error;
            state.muted = true;
            state.error = Some(format!("{error:#}"));
        }
    }
    result
}

async fn execute(
    options: &Connect,
    status: &SharedStatus,
    cancel: &mut watch::Receiver<Option<bool>>,
    commands: &mut mpsc::Receiver<Command>,
) -> Result<()> {
    let mut connection = tokio::select! {
        _ = cancel.changed() => {
            if *cancel.borrow() == Some(true) {
                bail!("Connection cancelled before host shutdown could be confirmed; stop the selected voice listener from Pi");
            }
            return Ok(());
        },
        result = Connection::open(options) => result?,
    };
    let mut audio = match tokio::select! {
        _ = cancel.changed() => None,
        result = Audio::start(&options.microphone, &options.speaker) => Some(result),
    } {
        Some(Ok(audio)) => audio,
        other => {
            let stopped = if other.is_none() && *cancel.borrow() == Some(true) {
                match options.provider {
                    Provider::Grok => connection.stop_grok_call().await
                        .context("Local audio released, but ending the selected host call was not confirmed; stop it from Pi"),
                    // No transport client owns the browser call yet; do not stop another device's call.
                    Provider::Gippity | Provider::Codex => Err(anyhow::anyhow!(
                        "Connection cancelled before host shutdown could be confirmed; stop the selected voice listener from Pi"
                    )),
                }
            } else {
                Ok(())
            };
            let closed = connection.close().await;
            stopped.and(closed)?;
            return match other {
                Some(Err(error)) => Err(error),
                _ => Ok(()),
            };
        }
    };
    let client = uuid::Uuid::new_v4().to_string();
    let mut transport = None;
    let (result, end_call) = tokio::select! {
        biased;
        _ = cancel.changed() => (Ok(()), *cancel.borrow() == Some(true)),
        result = conversation(options, status, &mut connection, &mut audio, commands, &client, &mut transport) => (result, false),
    };
    // Release hardware before waiting on the host, but retain transport/tunnel for Stop.
    let audio_closed = audio.close().await;
    let stopped = if end_call {
        let stop = async {
            match options.provider {
                Provider::Gippity | Provider::Codex => {
                    if let Some(transport) = transport.as_mut() {
                        // HTTP below confirms completion; a failed WS send is not an ACK.
                        let _ = tokio::time::timeout(
                            Duration::from_secs(1),
                            transport.send(json!({"type":"release"})),
                        )
                        .await;
                    }
                    connection.stop_browser_call(&client).await
                }
                Provider::Grok => connection.stop_grok_call().await,
            }
        }
        .await;
        stop.context("Local audio released, but ending the selected host call was not confirmed; stop it from Pi")
    } else {
        Ok(())
    };
    if let Some(transport) = transport.as_mut() {
        transport.close().await;
    }
    let tunnel_closed = connection.close().await;
    result.and(stopped).and(audio_closed).and(tunnel_closed)
}

struct Playback {
    active: bool,
    input_ready: bool,
    muted: bool,
    resume_muted: Option<bool>,
    suppressed: bool,
    next_drain: u32,
    draining: Option<(u32, u64)>,
    drains: VecDeque<u64>,
}

impl Playback {
    async fn status(&self, status: &SharedStatus) {
        let mut status = status.write().await;
        status.muted = self.muted;
        status.phase = if !self.active {
            Phase::Connecting
        } else if self.muted {
            Phase::Muted
        } else {
            Phase::Listening
        };
    }

    async fn mute(&mut self, muted: bool, audio: &mut Audio, status: &SharedStatus) -> Result<()> {
        self.muted = muted;
        audio.set_muted(muted || !self.input_ready).await?;
        self.status(status).await;
        Ok(())
    }

    async fn clear(&mut self, audio: &mut Audio) -> Result<()> {
        self.draining = None;
        self.drains.clear();
        audio.send(b'C', &[]).await
    }

    async fn next_drain(&mut self, audio: &mut Audio) -> Result<()> {
        if self.draining.is_none()
            && let Some(remote) = self.drains.pop_front()
        {
            self.next_drain = self.next_drain.wrapping_add(1);
            self.draining = Some((self.next_drain, remote));
            audio.send(b'D', &self.next_drain.to_le_bytes()).await?;
        }
        Ok(())
    }

    async fn frame(
        &mut self,
        frame: Frame,
        audio: &mut Audio,
        transport: &mut Transport,
    ) -> Result<()> {
        match frame.tag {
            b'A' if self.input_ready => {
                if let Some(pcm) = audio.capture(&frame) {
                    transport
                        .socket
                        .send(Message::Binary(pcm.to_vec().into()))
                        .await?;
                }
            }
            b'D' => {
                let id = u32::from_le_bytes(frame.bytes[..4].try_into()?);
                if let Some((pending, remote)) = self.draining
                    && pending == id
                {
                    self.draining = None;
                    transport
                        .send(json!({"type":"drained","id":remote}))
                        .await?;
                    self.next_drain(audio).await?;
                }
            }
            b'R' => bail!("Audio helper restarted unexpectedly; reconnect from the panel"),
            _ => (),
        }
        Ok(())
    }
}

async fn conversation(
    options: &Connect,
    status: &SharedStatus,
    connection: &mut Connection,
    audio: &mut Audio,
    commands: &mut mpsc::Receiver<Command>,
    client: &str,
    owned_transport: &mut Option<Transport>,
) -> Result<()> {
    *owned_transport = Some(
        tokio::time::timeout(
            Duration::from_secs(15),
            Transport::open(connection, options.provider, client, None),
        )
        .await
        .context("Voice connection timed out; check the selected server and certificate")??,
    );
    let transport = owned_transport
        .as_mut()
        .context("Voice transport did not open")?;
    let mut playback = Playback {
        active: false,
        input_ready: false,
        muted: false,
        resume_muted: None,
        suppressed: false,
        next_drain: 0,
        draining: None,
        drains: VecDeque::new(),
    };
    let mut health = tokio::time::interval(Duration::from_secs(1));
    async {
        loop {
            let value = tokio::select! {
                frame = audio.read() => { playback.frame(frame?, audio, transport).await?; continue; },
                command = commands.recv() => {
                    let Some(Command::Mute(muted, reply)) = command else { return Ok(()); };
                    let result = async {
                        if !playback.active { bail!("Voice is still connecting; wait before changing mute"); }
                        playback.mute(muted, audio, status).await?;
                        match options.provider {
                            Provider::Gippity | Provider::Codex => transport.send(json!({"type":"mute","muted":muted})).await?,
                            Provider::Grok => connection.post("/control", json!({"action":"mute","muted":muted})).await?,
                        }
                        Ok(())
                    }.await;
                    let failed = result.is_err();
                    let message = result.as_ref().err().map(|error| format!("{error:#}"));
                    let _ = reply.send(result.map_err(|error| format!("{error:#}")));
                    if failed { bail!("{}", message.as_deref().unwrap_or("Cannot update microphone mute")); }
                    continue;
                },
                _ = health.tick() => { connection.check_tunnel()?; continue; },
                event = transport.events.next() => event?,
                message = transport.socket.next() => {
                    match message.context("Voice connection closed; reconnect from the panel")?? {
                        Message::Binary(bytes) => {
                            if bytes.is_empty() || bytes.len() % 2 != 0 || bytes.len() > 48_000 { bail!("Invalid speaker audio from voice server"); }
                            if !playback.suppressed { audio.send(b'P', &bytes).await?; }
                            continue;
                        },
                        Message::Text(text) => serde_json::from_str::<Value>(&text).context("Invalid voice control message")?,
                        Message::Ping(bytes) => { transport.socket.send(Message::Pong(bytes)).await?; continue; },
                        Message::Close(_) => bail!("Voice device disconnected or was replaced; reconnect from the panel"),
                        _ => continue,
                    }
                },
            };
            match value["type"].as_str() {
                Some("active") if options.provider.is_openai() => {
                    playback.active = true;
                    playback.input_ready = true;
                    playback.suppressed = value["speakerSuppressed"].as_bool().unwrap_or(false);
                    let muted = playback.resume_muted.take().unwrap_or(value["muted"].as_bool().unwrap_or(false));
                    playback.mute(muted, audio, status).await?;
                    transport.send(json!({"type":"mute","muted":muted})).await?;
                },
                Some("ready") if options.provider == Provider::Grok => {
                    // RemoteAudio is ready to receive PCM before provider startup completes.
                    playback.input_ready = true;
                    audio.set_muted(playback.muted).await?;
                },
                Some("state") if options.provider == Provider::Grok => {
                    playback.active = matches!(value["status"].as_str(), Some("listening" | "responding" | "speaking" | "ending"));
                    playback.mute(value["muted"].as_bool().context("Invalid remote mute state")?, audio, status).await?;
                    if value["status"].as_str() == Some("idle") { return Ok(()); }
                },
                Some("mute") => playback.mute(value["muted"].as_bool().context("Invalid remote mute state")?, audio, status).await?,
                Some("clear") => playback.clear(audio).await?,
                Some("speaker_suppressed") => {
                    playback.suppressed = value["suppressed"].as_bool().context("Invalid speaker state")?;
                    if playback.suppressed { playback.clear(audio).await?; }
                },
                Some("drain") if options.provider == Provider::Grok => {
                    playback.drains.push_back(value["id"].as_u64().context("Invalid playback completion request")?);
                    playback.next_drain(audio).await?;
                },
                Some("stop") => {
                    if value["reason"] == "replaced" { bail!("Voice moved to another device; reconnect to take it back"); }
                    return Ok(());
                },
                Some("error") => bail!("{}", value["message"].as_str().unwrap_or("Voice failed; check Pi and reconnect")),
                Some("takeover") if options.provider.is_openai() => {
                    let token = value["token"].as_str().context("Invalid voice transfer request")?;
                    uuid::Uuid::parse_str(token).context("Invalid voice transfer token")?;
                    playback.resume_muted = Some(playback.muted);
                    playback.active = false;
                    playback.input_ready = false;
                    playback.suppressed = true;
                    playback.clear(audio).await?;
                    audio.set_muted(true).await?;
                    playback.status(status).await;
                    transport.send(json!({"type":"takeover.ack","token":token})).await?;
                    transport.close().await;
                    *transport = Transport::replacement(connection, options.provider, client, token).await?;
                },
                _ => (),
            }
        }
    }.await
}
