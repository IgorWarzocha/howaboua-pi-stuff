mod auth;
mod cli;
mod cloudflare;
mod http;
mod navigation;
mod page;
mod paths;
mod responses;
mod session;
mod types;

use anyhow::Context;
use serde_json::json;
use std::env;

const DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const DEFAULT_MODEL: &str = "gpt-5.4-mini";
const DEFAULT_ORIGINATOR: &str = "codex_cli_rs";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = cli::parse_args()?;
    let auth = auth::read_codex_auth().await?;
    let client = http::build_codex_http_client()?;
    if let Some(output) = navigation::handle_navigation_commands(&args, &client).await? {
        println!("{}", output);
        return Ok(());
    }
    let model = args
        .model
        .clone()
        .or_else(|| env::var("PI_CODEX_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let request = responses::build_responses_web_search_request(&args, model)?;
    let url = http::codex_responses_url();

    let response = client
        .post(&url)
        .headers(http::headers(&auth)?)
        .json(&request)
        .send()
        .await
        .with_context(|| format!("web_run Responses web search request failed for `{url}`"))?;

    let status = response.status();
    let cloudflare_mitigated = response
        .headers()
        .get("cf-mitigated")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("challenge"));
    let cloudflare_server = response
        .headers()
        .get("server")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("cloudflare"));
    let body = response
        .text()
        .await
        .context("failed to read web_run response")?;
    let cloudflare_challenge =
        cloudflare_mitigated || (cloudflare_server && body.trim_start().starts_with("<html"));
    if !status.is_success() {
        if status.as_u16() == 403
            && (cloudflare_challenge || body.to_ascii_lowercase().contains("cloudflare"))
        {
            anyhow::bail!(
                "web_run Responses web search failed for `{url}`: HTTP 403 Cloudflare challenge"
            );
        }
        if status.as_u16() == 404 && body.contains("\"Not Found\"") {
            anyhow::bail!(
                "web_run Responses web search failed for `{url}`: HTTP 404 Not Found (Codex endpoint unavailable for this account/backend)"
            );
        }
        anyhow::bail!("web_run Responses web search failed for `{url}`: HTTP {status} {body}");
    }

    let (text, search_results) = responses::output_from_sse(&body)
        .context("failed to decode web_run Responses search response")?;
    let mut state = session::load_web_run_session(&args);
    state.search_results = search_results.clone();
    session::save_web_run_session(&args, &state)?;
    println!(
        "{}",
        json!({
            "output_text": text,
            "search_results": search_results,
        })
    );
    Ok(())
}
