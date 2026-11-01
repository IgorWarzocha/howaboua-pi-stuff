use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::process::Command;

const PIPEWIRE_ID: &str = "pipewire:";

pub async fn list() -> Result<Value> {
    if let Some(devices) = pipewire_devices().await? {
        return Ok(devices);
    }
    helper_devices(&Routing::default()).await
}

async fn helper_devices(routing: &Routing) -> Result<Value> {
    let mut command = Command::new(super::helper_path()?);
    routing.apply(&mut command);
    command.arg("--devices");
    let bytes = output(command, "Audio device discovery").await?;
    let value: Value = serde_json::from_slice(&bytes).context("Invalid audio device list")?;
    for kind in ["microphones", "speakers"] {
        let list = value[kind]
            .as_array()
            .context("Invalid audio device list")?;
        ensure!(
            list.iter()
                .all(|d| d["name"].is_string() && d["description"].is_string()),
            "Invalid audio device entry"
        );
    }
    Ok(value)
}

async fn output(mut command: Command, operation: &str) -> Result<Vec<u8>> {
    command
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command
        .spawn()
        .with_context(|| format!("{operation} could not start"))?;
    let result = tokio::time::timeout(Duration::from_secs(10), child.wait_with_output())
        .await
        .with_context(|| format!("{operation} timed out"))??;
    ensure!(
        result.status.success(),
        "{operation} failed: {}",
        String::from_utf8_lossy(&result.stderr).trim()
    );
    Ok(result.stdout)
}

#[cfg(not(target_os = "linux"))]
async fn pipewire_devices() -> Result<Option<Value>> {
    Ok(None)
}

#[cfg(target_os = "linux")]
async fn pipewire_devices() -> Result<Option<Value>> {
    // A machine without a local PipeWire server retains the native helper catalogue.
    // When a server is present, discovery failures must not masquerade as raw ALSA devices.
    let remote = std::env::var_os("PIPEWIRE_REMOTE");
    let socket = std::env::var_os("PIPEWIRE_RUNTIME_DIR")
        .or_else(|| std::env::var_os("XDG_RUNTIME_DIR"))
        .map(PathBuf::from)
        .map(|path| {
            path.join(
                remote
                    .as_deref()
                    .unwrap_or(std::ffi::OsStr::new("pipewire-0")),
            )
        });
    if remote.is_none() && !socket.is_some_and(|path| path.exists()) {
        return Ok(None);
    }
    let bytes = output(
        Command::new("pw-dump"),
        "PipeWire device discovery; check pw-dump and the local audio service",
    )
    .await?;
    let dump: Value = serde_json::from_slice(&bytes).context("Invalid PipeWire device list")?;
    let objects = dump.as_array().context("Invalid PipeWire device list")?;
    let mut microphones = Vec::new();
    let mut speakers = Vec::new();
    for object in objects {
        if object["type"] != "PipeWire:Interface:Node" {
            continue;
        }
        let props = &object["info"]["props"];
        let target = match props["media.class"].as_str() {
            Some("Audio/Source") => &mut microphones,
            Some("Audio/Sink") => &mut speakers,
            _ => continue,
        };
        let name = props["node.name"]
            .as_str()
            .filter(|name| !name.is_empty())
            .context("PipeWire audio device has no name; check the local audio service")?;
        let description = props["node.description"]
            .as_str()
            .or_else(|| props["node.nick"].as_str())
            .filter(|label| !label.is_empty())
            .unwrap_or(name);
        target.push(json!({"name": format!("{PIPEWIRE_ID}{name}"), "description": description}));
    }
    for devices in [&mut microphones, &mut speakers] {
        devices.sort_by(|a, b| {
            a["description"]
                .as_str()
                .cmp(&b["description"].as_str())
                .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
        });
    }
    Ok(Some(
        json!({"microphones": microphones, "speakers": speakers}),
    ))
}

#[derive(Default)]
pub struct Routing {
    pub microphone: String,
    pub speaker: String,
    directory: Option<PathBuf>,
}

impl Routing {
    pub async fn prepare(microphone: &str, speaker: &str) -> Result<Self> {
        let mut routing = Self {
            microphone: microphone.into(),
            speaker: speaker.into(),
            directory: None,
        };
        let selections = [
            (microphone, "microphones", "herdr_voice_input"),
            (speaker, "speakers", "herdr_voice_output"),
        ];
        if selections
            .iter()
            .any(|(id, _, _)| id.starts_with(PIPEWIRE_ID))
        {
            let devices = pipewire_devices().await?.context(
                "Selected PipeWire devices are unavailable; select local devices in settings",
            )?;
            let mut config = String::from("</usr/share/alsa/alsa.conf>\n");
            for (id, kind, alias) in selections {
                if let Some(node) = id.strip_prefix(PIPEWIRE_ID) {
                    require_device(&devices, kind, id)?;
                    // Quoting prevents node names from becoming ALSA configuration syntax.
                    let node = alsa_string(node)?;
                    config.push_str(&format!("pcm.{alias} {{\n type pipewire\n capture_node {node}\n playback_node {node}\n hint {{ show on description \"{alias}\" }}\n}}\n"));
                }
            }
            routing.write_config(&config).await?;
        }
        let available = helper_devices(&routing).await?;
        for (id, kind, alias) in selections {
            let selected = if id.starts_with(PIPEWIRE_ID) {
                format!("alsa:{alias}")
            } else {
                id.into()
            };
            if !selected.is_empty() {
                require_device(&available, kind, &selected)?;
            }
            if kind == "microphones" {
                routing.microphone = selected;
            } else {
                routing.speaker = selected;
            }
        }
        Ok(routing)
    }

    pub fn apply(&self, command: &mut Command) {
        if let Some(directory) = &self.directory {
            command
                .env("ALSA_CONFIG_PATH", directory.join("alsa.conf"))
                // Pin only this child's streams; never alter session-manager defaults.
                .env(
                    "PIPEWIRE_ALSA",
                    "node.dont-fallback=true node.dont-reconnect=true node.dont-move=true",
                )
                .env_remove("PIPEWIRE_NODE");
        }
    }

    #[cfg(target_os = "linux")]
    async fn write_config(&mut self, config: &str) -> Result<()> {
        use std::os::unix::fs::DirBuilderExt;
        let directory =
            std::env::temp_dir().join(format!("herdr-voice-audio-{}", uuid::Uuid::new_v4()));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .context("Cannot create private audio routing directory")?;
        self.directory = Some(directory.clone());
        tokio::fs::write(directory.join("alsa.conf"), config)
            .await
            .context("Cannot write private audio routing configuration")?;
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    async fn write_config(&mut self, _config: &str) -> Result<()> {
        bail!(
            "PipeWire selections are not supported on this system; select local devices in settings"
        )
    }
}

impl Drop for Routing {
    fn drop(&mut self) {
        if let Some(directory) = &self.directory {
            let _ = std::fs::remove_dir_all(directory);
        }
    }
}

fn require_device(devices: &Value, kind: &str, id: &str) -> Result<()> {
    let label = if kind == "microphones" {
        "microphone"
    } else {
        "speaker"
    };
    ensure!(
        devices[kind]
            .as_array()
            .is_some_and(|list| list.iter().any(|device| device["name"] == id)),
        "Selected {label} is unavailable; select an available local device in settings"
    );
    Ok(())
}

fn alsa_string(value: &str) -> Result<String> {
    if value.chars().any(char::is_control) {
        bail!("Selected PipeWire node name contains unsupported control characters");
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}
