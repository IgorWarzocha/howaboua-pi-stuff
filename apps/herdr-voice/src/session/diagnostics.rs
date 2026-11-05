use crate::connection::Socket;
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio_tungstenite::MaybeTlsStream;

/// Content-free, connection-local observations. Ages use monotonic time; wall time
/// and the host echo bound cross-machine alignment instead of assuming clock sync.
pub struct Diagnostics {
    started: Instant,
    window: Instant,
    received: Option<Instant>,
    packets: u64,
    bytes: u64,
    suppressed: u64,
    max_gap_us: u128,
    max_ipc_us: u128,
    max_capture_send_us: u128,
    max_helper_read_queue_us: u128,
    local: String,
    peer: String,
    probe: Option<(u128, Instant, Option<u128>)>,
    rtt_us: Option<u128>,
    host_unix_ms: Option<u64>,
    echo_client_unix_ms: Option<u128>,
    client_id: String,
    ssh_forwarded: bool,
}

impl Diagnostics {
    pub fn new(socket: &Socket, client: &str, ssh_forwarded: bool) -> Result<Self> {
        let tcp = match socket.get_ref() {
            MaybeTlsStream::Plain(tcp) => tcp,
            MaybeTlsStream::NativeTls(tls) => tls.get_ref().get_ref().get_ref(),
            _ => bail!("Cannot identify the voice socket route"),
        };
        let now = Instant::now();
        Ok(Self {
            started: now,
            window: now,
            received: None,
            packets: 0,
            bytes: 0,
            suppressed: 0,
            max_gap_us: 0,
            max_ipc_us: 0,
            max_capture_send_us: 0,
            max_helper_read_queue_us: 0,
            local: tcp.local_addr()?.to_string(),
            peer: tcp.peer_addr()?.to_string(),
            probe: None,
            rtt_us: None,
            host_unix_ms: None,
            echo_client_unix_ms: None,
            client_id: client.to_owned(),
            ssh_forwarded,
        })
    }

    pub fn receive(&mut self, bytes: usize, suppressed: bool) {
        let now = Instant::now();
        if let Some(last) = self.received.replace(now) {
            self.max_gap_us = self.max_gap_us.max(now.duration_since(last).as_micros());
        }
        self.packets += 1;
        self.bytes += bytes as u64;
        self.suppressed += u64::from(suppressed);
    }

    pub fn ipc(&mut self, start: Instant) {
        self.max_ipc_us = self.max_ipc_us.max(start.elapsed().as_micros());
    }

    pub fn capture_send(&mut self, start: Instant) {
        self.max_capture_send_us = self.max_capture_send_us.max(start.elapsed().as_micros());
    }

    pub fn helper_read(&mut self, received_at: Instant) {
        self.max_helper_read_queue_us = self
            .max_helper_read_queue_us
            .max(received_at.elapsed().as_micros());
    }

    pub fn ack(&mut self, value: &Value) {
        if let Some((id, probe, unix_ms)) = self.probe
            && value["probeId"].as_u64().map(u128::from) == Some(id)
        {
            self.probe = None;
            self.rtt_us = Some(probe.elapsed().as_micros());
            self.host_unix_ms = value["hostUnixMs"].as_u64();
            self.echo_client_unix_ms = unix_ms;
        }
    }

    pub fn report(
        &mut self,
        helper: Value,
        suppressed: bool,
        host_enabled: bool,
        log_drops: u64,
    ) -> Value {
        let now = Instant::now();
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_millis());
        let probe_id = now.duration_since(self.started).as_micros();
        let report = json!({
            "type": "native_audio_diagnostics", "version": 1,
            "clientId": self.client_id,
            "local": self.local, "peer": self.peer,
            "client": {
                "unix_ms": unix_ms, "probe_id": probe_id, "ssh_forwarded": u8::from(self.ssh_forwarded),
                "host_reports_enabled": u8::from(host_enabled), "log_queue_drops": log_drops,
                "elapsed_ms": now.duration_since(self.started).as_millis(),
                "window_ms": now.duration_since(self.window).as_millis(),
                "packets": self.packets, "bytes": self.bytes, "suppressed_packets": self.suppressed,
                "suppressed": u8::from(suppressed),
                "receive_age_ms": self.received.map(|last| now.duration_since(last).as_millis()),
                "max_receive_gap_us": self.max_gap_us, "max_helper_write_us": self.max_ipc_us,
                "max_capture_send_us": self.max_capture_send_us,
                "max_helper_read_queue_us": self.max_helper_read_queue_us,
                "round_trip_us": self.rtt_us, "host_echo_unix_ms": self.host_unix_ms,
                "host_echo_client_unix_ms": self.echo_client_unix_ms,
            },
            "helper": helper,
        });
        self.window = now;
        self.packets = 0;
        self.bytes = 0;
        self.suppressed = 0;
        self.max_gap_us = 0;
        self.max_ipc_us = 0;
        self.max_capture_send_us = 0;
        self.max_helper_read_queue_us = 0;
        self.probe = Some((probe_id, now, unix_ms));
        report
    }
}

/// Always-on local receipt, including servers without diagnostics support.
/// Two bounded files; no audio, device names, URLs, transcripts or credentials.
async fn persist(report: &Value) -> Result<()> {
    use tokio::{fs, io::AsyncWriteExt};
    let directory = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot locate local diagnostic storage"))?
        .join("herdr-voice");
    fs::create_dir_all(&directory).await?;
    let path = directory.join("audio-diagnostics.jsonl");
    if fs::metadata(&path)
        .await
        .is_ok_and(|m| m.len() >= 2 * 1024 * 1024)
    {
        let previous = directory.join("audio-diagnostics.previous.jsonl");
        match fs::remove_file(&previous).await {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.into()),
        }
        fs::rename(&path, previous).await?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(format!("{report}\n").as_bytes()).await?;
    Ok(())
}

/// Disk I/O never blocks the audio pump. A full log queue is counted, not hidden.
pub struct Log {
    sender: Option<tokio::sync::mpsc::Sender<Value>>,
    worker: tokio::task::JoinHandle<()>,
    pub dropped: u64,
}

impl Log {
    pub fn new() -> Self {
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<Value>(8);
        let worker = tokio::spawn(async move {
            while let Some(report) = receiver.recv().await {
                if let Err(error) = persist(&report).await {
                    eprintln!("Speaker diagnostics could not be saved locally: {error}");
                }
            }
        });
        Self {
            sender: Some(sender),
            worker,
            dropped: 0,
        }
    }

    pub fn submit(&mut self, report: Value) {
        if self
            .sender
            .as_ref()
            .is_none_or(|sender| sender.try_send(report).is_err())
        {
            self.dropped += 1;
        }
    }

    pub async fn close(&mut self) {
        self.sender.take();
        if tokio::time::timeout(std::time::Duration::from_secs(1), &mut self.worker)
            .await
            .is_err()
        {
            self.worker.abort();
            let _ = (&mut self.worker).await;
            eprintln!("Speaker diagnostics log did not finish before disconnect");
        }
    }
}

impl Drop for Log {
    fn drop(&mut self) {
        self.worker.abort();
    }
}
