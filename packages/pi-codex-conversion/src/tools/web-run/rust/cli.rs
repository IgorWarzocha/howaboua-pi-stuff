use std::env;
use std::io::Read;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::types::{SearchCommands, SearchSettings};

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct WebRunArgs {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(flatten)]
    pub commands: SearchCommands,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning: Option<serde_json::Value>,
    #[serde(default)]
    pub input: Option<serde_json::Value>,
    #[serde(default)]
    pub settings: Option<SearchSettings>,
    #[serde(default)]
    pub max_output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebRunSearchResult {
    pub ref_id: String,
    pub title: String,
    pub url: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebRunPageLine {
    pub line: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebRunPageLink {
    pub id: u64,
    pub text: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebRunPage {
    pub ref_id: String,
    pub url: String,
    pub title: String,
    pub content: Vec<WebRunPageLine>,
    pub links: Vec<WebRunPageLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct WebRunSessionState {
    pub search_results: Vec<WebRunSearchResult>,
    pub pages: Vec<WebRunPage>,
}

pub fn parse_args() -> anyhow::Result<WebRunArgs> {
    let mut args = env::args().skip(1);
    let input = match args.next() {
        None => {
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .context("failed to read web_run JSON arguments from stdin")?;
            stdin
        }
        Some(first) if first == "-" => {
            if args.next().is_some() {
                anyhow::bail!("web_run accepts a single JSON argument or stdin");
            }
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .context("failed to read web_run JSON arguments from stdin")?;
            stdin
        }
        Some(first) => {
            if args.next().is_some() {
                anyhow::bail!("web_run accepts a single JSON argument or stdin");
            }
            first
        }
    };
    if input.trim().is_empty() {
        anyhow::bail!("web_run requires JSON arguments");
    }
    serde_json::from_str(input.trim()).context("failed to parse web_run JSON arguments")
}
