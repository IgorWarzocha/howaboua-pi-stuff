mod types;

use std::{env, fs};
use std::io::Read;
use std::path::PathBuf;

use anyhow::Context;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::{json, Value};
use types::{SearchCommands, SearchQuery, SearchSettings};
const DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api";
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

fn responses_url() -> String {
    let base = env::var("PI_CODEX_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    let normalized = base.trim_end_matches('/');
    if normalized.ends_with("/codex/responses") {
        normalized.to_string()
    } else if normalized.ends_with("/codex") {
        format!("{normalized}/responses")
    } else {
        format!("{normalized}/codex/responses")
    }
}

fn headers(token: &str, account_id: &str) -> anyhow::Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert("Authorization", HeaderValue::from_str(&format!("Bearer {token}"))?);
    headers.insert("chatgpt-account-id", HeaderValue::from_str(account_id)?);
    headers.insert("originator", HeaderValue::from_static("pi"));
    headers.insert("OpenAI-Beta", HeaderValue::from_static("responses=experimental"));
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    headers.insert("accept", HeaderValue::from_static("text/event-stream"));
    headers.insert("User-Agent", HeaderValue::from_static("pi-codex-conversion web_run path-tool"));
    Ok(headers)
}

fn first_query(commands: &SearchCommands) -> Option<String> {
    fn query_from_list(items: &Option<Vec<SearchQuery>>) -> Option<String> {
        items.as_ref()?.first().map(|query| query.q.clone())
    }
    query_from_list(&commands.search_query)
        .or_else(|| query_from_list(&commands.image_query))
        .or_else(|| commands.open.as_ref()?.first().map(|op| format!("open {}", op.ref_id)))
}

fn build_responses_body(args: &WebRunArgs, model: String) -> Value {
    let query = args.input.clone().or_else(|| first_query(&args.commands)).unwrap_or_else(|| serde_json::to_string(&args.commands).unwrap_or_default());
    let context_size = args
        .settings
        .as_ref()
        .and_then(|settings| settings.search_context_size)
        .map(|size| match size {
            types::SearchContextSize::Low => "low",
            types::SearchContextSize::Medium => "medium",
            types::SearchContextSize::High => "high",
        })
        .unwrap_or("medium");

    let body = json!({
        "model": model,
        "instructions": "Use web search and answer concisely with sources. Preserve source citations.",
        "text": { "verbosity": "low" },
        "input": [{
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": query }]
        }],
        "tools": [{
            "type": "web_search",
            "external_web_access": true,
            "search_context_size": context_size
        }],
        "tool_choice": "required",
        "parallel_tool_calls": true,
        "store": false,
        "stream": true,
        "include": ["web_search_call.action.sources", "web_search_call.results"]
    });
    body
}

fn parse_sse_text(text: &str) -> Vec<Value> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut events = Vec::new();
    for frame in normalized.split("\n\n") {
        let mut data = String::new();
        for line in frame.lines() {
            if let Some(rest) = line.strip_prefix("data:") {
                if !data.is_empty() { data.push('\n'); }
                data.push_str(rest.trim_start());
            }
        }
        if data.is_empty() || data == "[DONE]" { continue; }
        if let Ok(value) = serde_json::from_str::<Value>(&data) {
            events.push(value);
        }
    }
    events
}

fn collect_response(events: &[Value]) -> Value {
    let mut text = String::new();
    let mut response_id = None::<String>;
    let mut usage = None::<Value>;
    let mut web_search_calls = Vec::new();
    let mut citations = Vec::<Value>::new();

    for event in events {
        match event.get("type").and_then(Value::as_str) {
            Some("response.created") => {
                response_id = event.get("response").and_then(|response| response.get("id")).and_then(Value::as_str).map(str::to_string);
            }
            Some("response.completed") => {
                usage = event.get("response").and_then(|response| response.get("usage")).cloned();
            }
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    text.push_str(delta);
                }
            }
            Some("response.output_item.done") => {
                let Some(item) = event.get("item") else { continue; };
                if item.get("type").and_then(Value::as_str) == Some("web_search_call") {
                    web_search_calls.push(item.clone());
                } else if item.get("type").and_then(Value::as_str) == Some("message") {
                    if let Some(content) = item.get("content").and_then(Value::as_array) {
                        for part in content {
                            if part.get("type").and_then(Value::as_str) != Some("output_text") { continue; }
                            if text.is_empty() {
                                if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                                    text.push_str(part_text);
                                }
                            }
                            if let Some(annotations) = part.get("annotations").and_then(Value::as_array) {
                                for annotation in annotations {
                                    if annotation.get("type").and_then(Value::as_str) == Some("url_citation") {
                                        citations.push(annotation.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    json!({
        "text": text,
        "response_id": response_id,
        "usage": usage,
        "citations": citations,
        "web_search_calls": web_search_calls
    })
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
    let request = build_responses_body(&args, model);

    let response = reqwest::Client::new()
        .post(responses_url())
        .headers(headers(&auth.token, &auth.account_id)?)
        .json(&request)
        .send()
        .await
        .context("web_run responses request failed")?;

    let status = response.status();
    let body = response.text().await.context("failed to read web_run response")?;
    if !status.is_success() {
        anyhow::bail!("web_run responses failed: HTTP {status} {body}");
    }

    let events = parse_sse_text(&body);
    if let Some(failed) = events.iter().find(|event| event.get("type").and_then(Value::as_str) == Some("response.failed")) {
        let message = failed
            .get("error")
            .and_then(|error| error.get("message").or_else(|| error.get("code")))
            .and_then(Value::as_str)
            .unwrap_or("web_run responses failed");
        anyhow::bail!("{message}");
    }
    println!("{}", collect_response(&events));
    Ok(())
}
