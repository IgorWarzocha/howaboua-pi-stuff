use serde_json::json;

use crate::cli::{WebRunArgs, WebRunSearchResult};
use crate::types;
use crate::types::SearchSettings;

fn search_context_size(settings: &Option<SearchSettings>) -> &'static str {
    match settings
        .as_ref()
        .and_then(|settings| settings.search_context_size.as_ref())
    {
        Some(types::SearchContextSize::Low) => "low",
        Some(types::SearchContextSize::Medium) | None => "medium",
        Some(types::SearchContextSize::High) => "high",
    }
}

fn search_prompt(args: &WebRunArgs) -> anyhow::Result<String> {
    if let Some(queries) = args.commands.search_query.as_ref()
        && let Some(query) = queries.first()
        && !query.q.trim().is_empty()
    {
        return Ok(query.q.clone());
    }
    if let Some(queries) = args.commands.image_query.as_ref()
        && let Some(query) = queries.first()
        && !query.q.trim().is_empty()
    {
        return Ok(format!("Find images and current sources for: {}", query.q));
    }
    anyhow::bail!("web_run requires search_query or image_query")
}

pub fn build_responses_web_search_request(
    args: &WebRunArgs,
    model: String,
) -> anyhow::Result<serde_json::Value> {
    let prompt = search_prompt(args)?;
    Ok(json!({
        "model": model,
        "instructions": "You are a concise web search assistant. Use web search, answer the query, and preserve source citations from annotations.",
        "input": [{
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": prompt }]
        }],
        "tools": [{
            "type": "web_search",
            "external_web_access": true,
            "search_context_size": search_context_size(&args.settings)
        }],
        "tool_choice": "required",
        "parallel_tool_calls": true,
        "store": false,
        "stream": true,
        "include": []
    }))
}

pub fn output_from_sse(body: &str) -> anyhow::Result<(String, Vec<WebRunSearchResult>)> {
    let mut text = String::new();
    let mut results = Vec::new();
    for block in body.split("\n\n") {
        let data = block
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let event: serde_json::Value = match serde_json::from_str(&data) {
            Ok(event) => event,
            Err(_) => continue,
        };
        if event.get("type").and_then(serde_json::Value::as_str)
            == Some("response.output_text.delta")
            && let Some(delta) = event.get("delta").and_then(serde_json::Value::as_str)
        {
            text.push_str(delta);
        }
        if event.get("type").and_then(serde_json::Value::as_str)
            == Some("response.output_item.done")
            && let Some(item) = event.get("item")
        {
            collect_url_citations(item, &mut results);
        }
        if event.get("type").and_then(serde_json::Value::as_str) == Some("response.failed") {
            let message = event
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Codex web search failed");
            anyhow::bail!(message.to_string());
        }
    }
    if text.trim().is_empty() {
        anyhow::bail!("web_run Responses search returned no text");
    }
    collect_plain_text_urls(&text, &mut results);
    Ok((text, results))
}

fn collect_plain_text_urls(text: &str, results: &mut Vec<WebRunSearchResult>) {
    for word in text.split_whitespace() {
        let url = word.trim_matches(|ch: char| {
            matches!(
                ch,
                ',' | '.' | ';' | ':' | ')' | ']' | '}' | '>' | '"' | '\''
            )
        });
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            continue;
        }
        if results.iter().any(|result| result.url == url) {
            continue;
        }
        let source = reqwest::Url::parse(url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(ToString::to_string))
            .unwrap_or_default();
        results.push(WebRunSearchResult {
            ref_id: format!("turn0search{}", results.len()),
            title: url.to_string(),
            url: url.to_string(),
            source,
        });
    }
}

fn collect_url_citations(item: &serde_json::Value, results: &mut Vec<WebRunSearchResult>) {
    let Some(content) = item.get("content").and_then(serde_json::Value::as_array) else {
        return;
    };
    for part in content {
        let Some(annotations) = part
            .get("annotations")
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };
        for annotation in annotations {
            let annotation_type = annotation
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if annotation_type != "url_citation" {
                continue;
            }
            let Some(url) = annotation.get("url").and_then(serde_json::Value::as_str) else {
                continue;
            };
            if results.iter().any(|result| result.url == url) {
                continue;
            }
            let title = annotation
                .get("title")
                .and_then(serde_json::Value::as_str)
                .filter(|title| !title.trim().is_empty())
                .unwrap_or(url)
                .to_string();
            let source = reqwest::Url::parse(url)
                .ok()
                .and_then(|parsed| parsed.host_str().map(ToString::to_string))
                .unwrap_or_default();
            results.push(WebRunSearchResult {
                ref_id: format!("turn0search{}", results.len()),
                title,
                url: url.to_string(),
                source,
            });
        }
    }
}
