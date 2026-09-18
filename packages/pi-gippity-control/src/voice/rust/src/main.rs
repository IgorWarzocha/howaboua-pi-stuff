mod audio;
mod codex_audio;
mod playout;
mod protocol;
mod resample;
mod v3;
mod v3_media;

use anyhow::{Context, Result};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use protocol::{Command, Event, PROTOCOL_VERSION};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

struct Dictation {
    _capture: audio::Capture,
    task: tokio::task::JoinHandle<()>,
}

enum Session {
    Idle,
    V3(Box<v3::V3Session>),
    Dictation(Dictation),
}

#[tokio::main]
async fn main() -> Result<()> {
    let (events_tx, mut events_rx) = mpsc::channel::<Event>(256);
    let writer_task = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(event) = events_rx.recv().await {
            let mut line = match serde_json::to_vec(&event) {
                Ok(line) => line,
                Err(error) => {
                    eprintln!("voice event encoding failed: {error}");
                    break;
                }
            };
            line.push(b'\n');
            if stdout.write_all(&line).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });
    events_tx
        .send(Event::Ready {
            version: PROTOCOL_VERSION,
        })
        .await?;

    let mut session = Session::Idle;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        let result = async {
            let command = protocol::parse_command(&line).context("invalid voice helper command")?;
            command.validate()?;
            match command {
                Command::ListDevices => {
                    let (inputs, outputs) = audio::devices()?;
                    events_tx.send(Event::Devices { inputs, outputs }).await?;
                }
                Command::StartV3 {
                    microphone,
                    speaker,
                } => {
                    stop(&mut session).await?;
                    events_tx
                        .send(Event::State {
                            state: "connecting",
                        })
                        .await?;
                    let (created, sdp) =
                        v3::V3Session::create_devices(microphone, speaker, events_tx.clone())
                            .await?;
                    session = Session::V3(Box::new(created));
                    events_tx.send(Event::Offer { sdp }).await?;
                }
                Command::StartV3Bridge => {
                    stop(&mut session).await?;
                    events_tx
                        .send(Event::State {
                            state: "connecting",
                        })
                        .await?;
                    let (created, sdp) = v3::V3Session::create_bridge(events_tx.clone()).await?;
                    session = Session::V3(Box::new(created));
                    events_tx.send(Event::Offer { sdp }).await?;
                }
                Command::ApplyAnswer { sdp } => match &session {
                    Session::V3(active) => active.apply_answer(sdp).await?,
                    _ => anyhow::bail!("cannot apply an answer without an active V3 session"),
                },
                Command::SetInputMuted { muted } => match &session {
                    Session::V3(active) => active.set_input_muted(muted).await?,
                    _ => anyhow::bail!("microphone muting requires an active V3 session"),
                },
                Command::SetSpeakerSuppressed { suppressed, epoch } => match &mut session {
                    Session::V3(active) => {
                        active.set_speaker_suppressed(suppressed, epoch)?;
                    }
                    _ => anyhow::bail!("speaker suppression requires an active V3 session"),
                },
                Command::StartDictation { microphone } => {
                    stop(&mut session).await?;
                    let capture = audio::capture(microphone.as_deref())?;
                    let queue = capture.frames.clone();
                    let dropped = capture.dropped.clone();
                    let failed = capture.failed.clone();
                    let source_rate = capture.sample_rate;
                    let dictation_events = events_tx.clone();
                    let task = tokio::spawn(async move {
                        let mut resampler =
                            match resample::LinearResampler::new(source_rate, 24_000) {
                                Ok(value) => value,
                                Err(error) => {
                                    let _ = dictation_events
                                        .send(Event::Error {
                                            message: error.to_string(),
                                        })
                                        .await;
                                    return;
                                }
                            };
                        let mut source = Vec::new();
                        let mut converted = Vec::new();
                        let mut pending = Vec::new();
                        let mut ticker =
                            tokio::time::interval(std::time::Duration::from_millis(20));
                        loop {
                            ticker.tick().await;
                            if failed.load(std::sync::atomic::Ordering::Acquire) {
                                let _ = dictation_events
                                    .send(Event::Error {
                                        message: "microphone stream failed".to_owned(),
                                    })
                                    .await;
                                return;
                            }
                            if dropped.swap(false, std::sync::atomic::Ordering::AcqRel) {
                                audio::clear(&queue);
                                resampler.reset();
                                pending.clear();
                            }
                            source.clear();
                            converted.clear();
                            for _ in 0..queue.capacity() {
                                let Some(frame) = queue.pop() else { break };
                                source.extend_from_slice(&frame.samples[..frame.len]);
                            }
                            resampler.process(&source, &mut converted);
                            pending.extend_from_slice(&converted);
                            while pending.len() >= 480 {
                                let frame: Vec<f32> = pending.drain(..480).collect();
                                let mut bytes = Vec::with_capacity(960);
                                for sample in frame {
                                    bytes.extend_from_slice(
                                        &((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                                            .to_le_bytes(),
                                    );
                                }
                                if dictation_events
                                    .send(Event::Pcm {
                                        audio: BASE64.encode(bytes),
                                        sample_rate: 24_000,
                                        num_channels: 1,
                                        epoch: None,
                                    })
                                    .await
                                    .is_err()
                                {
                                    return;
                                }
                            }
                        }
                    });
                    session = Session::Dictation(Dictation {
                        _capture: capture,
                        task,
                    });
                    events_tx.send(Event::State { state: "listening" }).await?;
                }
                Command::SendData { message } => match &session {
                    Session::V3(active) => active.send(message).await?,
                    _ => anyhow::bail!("data messages require an active V3 session"),
                },
                Command::SendPcm { audio, .. } => match &session {
                    Session::V3(active) => {
                        let pcm = BASE64
                            .decode(audio)
                            .context("invalid bridge PCM encoding")?;
                        if pcm.len() > protocol::MAX_PCM_BYTES {
                            anyhow::bail!("bridge PCM exceeds {} bytes", protocol::MAX_PCM_BYTES);
                        }
                        active.send_pcm(&pcm)?;
                    }
                    _ => anyhow::bail!("PCM input requires an active V3 session"),
                },
                Command::Stop => {
                    stop(&mut session).await?;
                    events_tx.send(Event::Stopped).await?;
                }
                Command::Shutdown => {
                    stop(&mut session).await?;
                    return Ok(true);
                }
            }
            Result::<bool>::Ok(false)
        }
        .await;
        match result {
            Ok(true) => break,
            Ok(false) => {}
            Err(error) => {
                events_tx
                    .send(Event::Error {
                        message: format!("{error:#}"),
                    })
                    .await?
            }
        }
    }
    stop(&mut session).await?;
    drop(events_tx);
    writer_task.await?;
    Ok(())
}

async fn stop(session: &mut Session) -> Result<()> {
    let previous = std::mem::replace(session, Session::Idle);
    match previous {
        Session::Idle => {}
        Session::V3(active) => active.close().await?,
        Session::Dictation(active) => {
            active.task.abort();
            let _ = active.task.await;
        }
    }
    Ok(())
}
