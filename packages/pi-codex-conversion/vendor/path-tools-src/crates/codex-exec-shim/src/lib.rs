use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod local_process;
pub mod process;
pub mod protocol;

pub use process::{ExecBackend, ExecProcess, ExecProcessEvent, ExecProcessEventReceiver, StartedExecProcess};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProcessId(String);

impl From<&str> for ProcessId { fn from(value: &str) -> Self { Self(value.to_string()) } }
impl From<String> for ProcessId { fn from(value: String) -> Self { Self(value) } }
impl std::fmt::Display for ProcessId { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { self.0.fmt(f) } }

#[derive(Debug, Error)]
pub enum ExecServerError {
    #[error("{0}")]
    Message(String),
}

impl From<anyhow::Error> for ExecServerError { fn from(value: anyhow::Error) -> Self { Self::Message(value.to_string()) } }
