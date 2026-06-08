mod types;

use std::io::Read;
use std::path::PathBuf;
use std::{env, fs};

use anyhow::Context;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, USER_AGENT};
use serde::Deserialize;
use serde_json::json;
use types::{AllowedCaller, SearchCommands, SearchRequest, SearchResponse, SearchSettings};
use uuid::Uuid;

const DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const DEFAULT_MODEL: &str = "gpt-5.4-mini";

#[derive(Debug, Deserialize)]
struct PiAuthFile {
    #[serde(rename = "openai-codex")]
    openai_codex: Option<PiOAuthCredential>,
}

#[derive(Debug, Deserialize)]
struct PiOAuthCredential {
    access: String,
    #[serde(rename = "accountId")]
    account_id: String,
}

struct CodexAuth {
    token: String,
    account_id: String,
}

#[derive(Debug, Deserialize)]
struct WebRunArgs {
    #[serde(flatten)]
    commands: SearchCommands,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input: Option<String>,
    #[serde(default)]
    settings: Option<SearchSettings>,
    #[serde(default)]
    max_output_tokens: Option<u64>,
}

fn parse_args() -> anyhow::Result<WebRunArgs> {
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

fn pi_agent_dir() -> PathBuf {
    if let Ok(path) = env::var("PI_CODING_AGENT_DIR") {
        return PathBuf::from(path);
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".pi").join("agent")
}

fn codex_home() -> PathBuf {
    if let Ok(path) = env::var("CODEX_HOME") {
        return PathBuf::from(path);
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".codex")
}

fn toml_string_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let first = trimmed.chars().next()?;
    let last = trimmed.chars().last()?;
    if (first != '"' && first != '\'') || last != first || trimmed.len() < 2 {
        return None;
    }
    Some(trimmed[1..trimmed.len() - 1].to_string())
}

fn codex_provider_base_url() -> Option<String> {
    let config_path = codex_home().join("config.toml");
    let source = fs::read_to_string(config_path).ok()?;
    let mut section = String::new();
    let mut root_provider = None;
    let mut root_openai_base_url = None;
    let mut active_profile = None;
    let mut profile_provider = None;
    let mut provider_bases = std::collections::HashMap::<String, String>::new();
    for raw_line in source.lines() {
        let line = raw_line.split('#').next().unwrap_or_default().trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].trim().to_string();
            continue;
        }
        let Some((key, raw_value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let Some(value) = toml_string_value(raw_value) else {
            continue;
        };
        if section.is_empty() {
            match key {
                "model_provider" => root_provider = Some(value),
                "openai_base_url" => root_openai_base_url = Some(value),
                "profile" => active_profile = Some(value),
                _ => {}
            }
        } else if let Some(profile_name) = section.strip_prefix("profiles.") {
            if active_profile.as_deref() == Some(profile_name) && key == "model_provider" {
                profile_provider = Some(value);
            }
        } else if let Some(provider_id) = section.strip_prefix("model_providers.") {
            if key == "base_url" {
                provider_bases.insert(provider_id.to_string(), value);
            }
        }
    }
    let provider_id = profile_provider.or(root_provider).unwrap_or_else(|| "openai".to_string());
    provider_bases
        .remove(&provider_id)
        .or_else(|| (provider_id == "openai").then_some(root_openai_base_url).flatten())
}

fn read_codex_auth() -> anyhow::Result<CodexAuth> {
    if let (Ok(token), Ok(account_id)) = (env::var("PI_CODEX_ACCESS_TOKEN"), env::var("PI_CODEX_ACCOUNT_ID")) {
        return Ok(CodexAuth { token, account_id });
    }
    let auth_path = env::var("PI_AUTH_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| pi_agent_dir().join("auth.json"));
    let auth: PiAuthFile = serde_json::from_str(
        &fs::read_to_string(&auth_path)
            .with_context(|| format!("failed to read Pi auth file `{}`", auth_path.display()))?,
    )
    .with_context(|| format!("failed to parse Pi auth file `{}`", auth_path.display()))?;
    let Some(credential) = auth.openai_codex else {
        anyhow::bail!("Pi auth file `{}` has no openai-codex credential; run /login openai-codex", auth_path.display());
    };
    if credential.access.is_empty() || credential.account_id.is_empty() {
        anyhow::bail!("Pi openai-codex credential is missing access token or account id; run /login openai-codex");
    }
    Ok(CodexAuth { token: credential.access, account_id: credential.account_id })
}

fn alpha_search_url() -> String {
    if let Ok(url) = env::var("PI_CODEX_ALPHA_SEARCH_URL") {
        return alpha_search_url_from_base(&url);
    }
    if let Ok(base) = env::var("PI_CODEX_ALPHA_BASE_URL") {
        return alpha_search_url_from_base(&base);
    }
    if let Ok(server_uri) = env::var("PI_CODEX_SERVER_URI") {
        return format!("{}/api/codex/alpha/search", server_uri.trim_end_matches('/'));
    }
    let base = env::var("PI_CODEX_BASE_URL")
        .ok()
        .or_else(codex_provider_base_url)
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
    alpha_search_url_from_base(&base)
}

fn alpha_search_url_from_base(base: &str) -> String {
    let normalized = base.trim_end_matches('/');
    if normalized.ends_with("/alpha/search") {
        normalized.to_string()
    } else if normalized.ends_with("/codex/responses") {
        format!("{}/alpha/search", normalized.trim_end_matches("/responses"))
    } else if normalized.ends_with("/api/codex") || normalized.ends_with("/backend-api/codex") || normalized.ends_with("/codex") {
        format!("{normalized}/alpha/search")
    } else if normalized.ends_with("/api") || normalized.ends_with("/backend-api") {
        format!("{normalized}/codex/alpha/search")
    } else {
        format!("{normalized}/api/codex/alpha/search")
    }
}

fn headers(token: &str, account_id: &str) -> anyhow::Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert("Authorization", HeaderValue::from_str(&format!("Bearer {token}"))?);
    headers.insert("chatgpt-account-id", HeaderValue::from_str(account_id)?);
    headers.insert("originator", HeaderValue::from_static("codex_cli_rs"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(USER_AGENT, HeaderValue::from_static("codex_cli_rs/0.0.0 (pi-codex-conversion)"));
    Ok(headers)
}

fn merge_settings(settings: Option<SearchSettings>) -> SearchSettings {
    let mut merged = settings.unwrap_or_default();
    if merged.allowed_callers.is_none() {
        merged.allowed_callers = Some(vec![AllowedCaller::Direct]);
    }
    if merged.external_web_access.is_none() {
        merged.external_web_access = Some(true);
    }
    merged
}

fn build_search_request(args: &WebRunArgs, model: String) -> SearchRequest {
    SearchRequest {
        id: format!("pi-web-run-{}", Uuid::new_v4()),
        model,
        input: args.input.clone(),
        commands: Some(args.commands.clone()),
        settings: Some(merge_settings(args.settings.clone())),
        max_output_tokens: args.max_output_tokens,
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args()?;
    let auth = read_codex_auth()?;
    let model = args
        .model
        .clone()
        .or_else(|| env::var("PI_CODEX_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let request = build_search_request(&args, model);
    let url = alpha_search_url();

    let response = reqwest::Client::builder()
        .user_agent("codex_cli_rs/0.0.0 (pi-codex-conversion)")
        .build()
        .context("failed to build web_run HTTP client")?
        .post(&url)
        .headers(headers(&auth.token, &auth.account_id)?)
        .json(&request)
        .send()
        .await
        .with_context(|| format!("web_run alpha/search request failed for `{url}`"))?;

    let status = response.status();
    let body = response.text().await.context("failed to read web_run response")?;
    if !status.is_success() {
        if status.as_u16() == 403 && body.to_ascii_lowercase().contains("cloudflare") {
            anyhow::bail!("web_run alpha/search failed for `{url}`: HTTP 403 Cloudflare challenge");
        }
        anyhow::bail!("web_run alpha/search failed for `{url}`: HTTP {status} {body}");
    }

    let parsed: SearchResponse = serde_json::from_str(&body).context("failed to decode web_run alpha/search response")?;
    println!("{}", json!({
        "text": "[encrypted web search output]",
        "encrypted_output": parsed.encrypted_output,
    }));
    Ok(())
}
