use anyhow::{Context, Result, bail};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::mpsc,
    task::JoinHandle,
};

mod devices;
pub use devices::list as devices;

pub struct Frame {
    pub tag: u8,
    pub bytes: Vec<u8>,
}

pub struct Audio {
    child: Child,
    input: ChildStdin,
    frames: mpsc::Receiver<Result<Frame>>,
    reader: JoinHandle<()>,
    muted: bool,
    epoch: u32,
    _routing: devices::Routing,
}

pub fn helper_path() -> Result<PathBuf> {
    Ok(std::env::current_exe()?
        .parent()
        .context("Cannot locate the audio bundle")?
        .join(if cfg!(windows) {
            "grok-audio.exe"
        } else {
            "grok-audio"
        }))
}

impl Audio {
    pub async fn start(microphone: &str, speaker: &str) -> Result<Self> {
        let routing = devices::Routing::prepare(microphone, speaker).await?;
        let mut command = Command::new(helper_path()?);
        routing.apply(&mut command);
        let mut child = command
            .args([&routing.microphone, &routing.speaker])
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .context("Cannot start bundled audio helper; install the complete native bundle")?;
        let input = child.stdin.take().context("Missing audio input")?;
        let output = child.stdout.take().context("Missing audio output")?;
        let (sender, frames) = mpsc::channel(64);
        let reader = tokio::spawn(async move {
            let mut output = output;
            loop {
                let frame = read_frame(&mut output).await;
                let failed = frame.is_err();
                if sender.send(frame).await.is_err() || failed {
                    break;
                }
            }
        });
        let mut audio = Self {
            child,
            input,
            frames,
            reader,
            muted: false,
            epoch: 0,
            _routing: routing,
        };
        let frame = tokio::time::timeout(Duration::from_secs(10), audio.read())
            .await
            .context("Microphone startup timed out; check system audio permissions")??;
        if frame.tag != b'R' {
            bail!("Audio helper did not report readiness");
        }
        audio.set_muted(true).await?;
        Ok(audio)
    }

    pub async fn read(&mut self) -> Result<Frame> {
        self.frames.recv().await.context("Audio reader stopped")?
    }

    pub fn capture<'a>(&self, frame: &'a Frame) -> Option<&'a [u8]> {
        if frame.tag != b'A' || self.muted {
            return None;
        }
        let epoch = u32::from_le_bytes(frame.bytes[..4].try_into().ok()?);
        (epoch == self.epoch).then_some(&frame.bytes[4..])
    }

    pub async fn send(&mut self, tag: u8, bytes: &[u8]) -> Result<()> {
        let size = u32::try_from(bytes.len()).context("Audio frame exceeds IPC representation")?;
        self.input.write_u8(tag).await?;
        self.input.write_u32_le(size).await?;
        self.input.write_all(bytes).await?;
        self.input.flush().await?;
        Ok(())
    }

    pub async fn set_muted(&mut self, muted: bool) -> Result<()> {
        if self.muted == muted {
            return Ok(());
        }
        self.muted = muted;
        self.epoch = self.epoch.wrapping_add(1);
        let mut bytes = self.epoch.to_le_bytes().to_vec();
        bytes.push(u8::from(muted));
        self.send(b'M', &bytes).await
    }

    pub async fn close(mut self) -> Result<()> {
        self.reader.abort();
        let _ = (&mut self.reader).await;
        if self.child.try_wait()?.is_none() {
            self.child
                .kill()
                .await
                .context("Cannot stop audio helper")?;
        }
        self.child.wait().await?;
        Ok(())
    }
}

impl Drop for Audio {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

async fn read_frame(output: &mut ChildStdout) -> Result<Frame> {
    let tag = output
        .read_u8()
        .await
        .context("Audio helper stopped; check system devices")?;
    let size = output.read_u32_le().await? as usize;
    if !matches!((tag, size), (b'R', 0) | (b'A', 964) | (b'D', 4)) {
        bail!("Invalid audio helper response; reinstall the native bundle");
    }
    let mut bytes = vec![0; size];
    output.read_exact(&mut bytes).await?;
    Ok(Frame { tag, bytes })
}
