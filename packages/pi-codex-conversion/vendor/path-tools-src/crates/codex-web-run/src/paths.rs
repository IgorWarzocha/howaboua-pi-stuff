use std::env;
use std::path::PathBuf;

pub fn pi_agent_dir() -> PathBuf {
    if let Ok(path) = env::var("PI_CODING_AGENT_DIR") {
        return PathBuf::from(path);
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".pi").join("agent")
}
