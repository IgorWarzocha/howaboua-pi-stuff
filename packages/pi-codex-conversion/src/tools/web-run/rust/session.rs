use std::path::PathBuf;
use std::{env, fs};

use anyhow::Context;

use crate::cli::{WebRunArgs, WebRunSessionState};
use crate::paths::pi_agent_dir;
use crate::types::SearchCommands;

fn web_run_session_id(args: &WebRunArgs) -> String {
    args.id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or("default")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn web_run_session_path(args: &WebRunArgs) -> PathBuf {
    if let Ok(path) = env::var("PI_WEB_RUN_STATE_PATH")
        && !path.trim().is_empty()
    {
        return PathBuf::from(path);
    }
    pi_agent_dir()
        .join("web-run-sessions")
        .join(format!("{}.json", web_run_session_id(args)))
}

pub fn load_web_run_session(args: &WebRunArgs) -> WebRunSessionState {
    let path = web_run_session_path(args);
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_web_run_session(args: &WebRunArgs, state: &WebRunSessionState) -> anyhow::Result<()> {
    let path = web_run_session_path(args);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create web_run session dir `{}`",
                parent.display()
            )
        })?;
    }
    fs::write(&path, serde_json::to_vec_pretty(state)?)
        .with_context(|| format!("failed to write web_run session `{}`", path.display()))
}

pub fn has_navigation_commands(commands: &SearchCommands) -> bool {
    commands
        .open
        .as_ref()
        .is_some_and(|items| !items.is_empty())
        || commands
            .click
            .as_ref()
            .is_some_and(|items| !items.is_empty())
        || commands
            .find
            .as_ref()
            .is_some_and(|items| !items.is_empty())
}
