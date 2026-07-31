use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u8 = 5;
pub const MAX_SDP_BYTES: usize = 256 * 1024;
pub const MAX_DATA_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_PCM_BYTES: usize = 64 * 1024;
pub const MAX_DEVICE_BYTES: usize = 512;
pub const MAX_DEVICES: usize = 128;

pub fn parse_command(input: &str) -> anyhow::Result<Command> {
    let value: Value = serde_json::from_str(input)?;
    let object = value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("voice helper command must be an object"))?;
    let command_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("voice helper command requires a string type"))?;
    let allowed: &[&str] = match command_type {
        "list_devices" | "stop" | "shutdown" => &["type"],
        "start_v3" => &["type", "microphone", "speaker"],
        "start_v3_bridge" => &["type"],
        "set_input_muted" => &["type", "muted"],
        "apply_answer" => &["type", "sdp"],
        "start_dictation" => &["type", "microphone"],
        "send_data" => &["type", "message"],
        "send_pcm" => &["type", "audio", "sample_rate", "num_channels"],
        _ => anyhow::bail!("unknown voice helper command type {command_type}"),
    };
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        anyhow::bail!("unknown {command_type} field {key}");
    }
    Ok(serde_json::from_value(value)?)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    ListDevices,
    StartV3 {
        microphone: Option<String>,
        speaker: Option<String>,
    },
    StartV3Bridge,
    SetInputMuted {
        muted: bool,
    },
    ApplyAnswer {
        sdp: String,
    },
    StartDictation {
        microphone: Option<String>,
    },
    SendData {
        message: Value,
    },
    SendPcm {
        audio: String,
        sample_rate: u32,
        num_channels: u16,
    },
    Stop,
    Shutdown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Ready {
        version: u8,
    },
    Devices {
        inputs: Vec<AudioDevice>,
        outputs: Vec<AudioDevice>,
    },
    Offer {
        sdp: String,
    },
    State {
        state: &'static str,
    },
    Data {
        message: Value,
    },
    Pcm {
        audio: String,
        sample_rate: u32,
        num_channels: u16,
    },
    Error {
        message: String,
    },
    Stopped,
}

#[derive(Clone, Debug, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

impl Command {
    pub fn validate(&self) -> anyhow::Result<()> {
        match self {
            Self::StartV3 {
                microphone,
                speaker,
            } if microphone
                .as_ref()
                .is_some_and(|value| value.len() > MAX_DEVICE_BYTES)
                || speaker
                    .as_ref()
                    .is_some_and(|value| value.len() > MAX_DEVICE_BYTES) =>
            {
                anyhow::bail!("audio device id exceeds {MAX_DEVICE_BYTES} bytes")
            }
            Self::StartDictation { microphone }
                if microphone
                    .as_ref()
                    .is_some_and(|value| value.len() > MAX_DEVICE_BYTES) =>
            {
                anyhow::bail!("audio device id exceeds {MAX_DEVICE_BYTES} bytes")
            }
            Self::ApplyAnswer { sdp } if sdp.len() > MAX_SDP_BYTES => {
                anyhow::bail!("answer SDP exceeds {MAX_SDP_BYTES} bytes")
            }
            Self::SendData { message } => {
                let size = serde_json::to_vec(message)?.len();
                if size > MAX_DATA_MESSAGE_BYTES {
                    anyhow::bail!("data-channel message exceeds {MAX_DATA_MESSAGE_BYTES} bytes");
                }
            }
            Self::SendPcm {
                audio,
                sample_rate,
                num_channels,
            } => {
                if *sample_rate != 24_000 || *num_channels != 1 {
                    anyhow::bail!("bridge PCM must be 24 kHz mono");
                }
                if audio.len() > MAX_PCM_BYTES * 4 / 3 + 4 {
                    anyhow::bail!("bridge PCM exceeds {MAX_PCM_BYTES} bytes");
                }
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_closed_and_bounded() {
        assert!(parse_command(r#"{"type":"unknown"}"#).is_err());
        assert!(parse_command(r#"{"type":"stop","extra":true}"#).is_err());
        assert!(parse_command(r#"{"type":"set_input_muted","muted":true}"#).is_ok());
        assert!(parse_command(r#"{"type":"set_input_muted","muted":"yes"}"#).is_err());
        assert!(parse_command(r#"{"type":"start_v3_bridge"}"#).is_ok());
        assert!(
            Command::SendPcm {
                audio: "AA==".to_owned(),
                sample_rate: 48_000,
                num_channels: 1,
            }
            .validate()
            .is_err()
        );
        assert!(
            Command::StartDictation {
                microphone: Some("x".repeat(MAX_DEVICE_BYTES + 1)),
            }
            .validate()
            .is_err()
        );
        assert!(
            Command::ApplyAnswer {
                sdp: "x".repeat(MAX_SDP_BYTES + 1)
            }
            .validate()
            .is_err()
        );
    }
}
