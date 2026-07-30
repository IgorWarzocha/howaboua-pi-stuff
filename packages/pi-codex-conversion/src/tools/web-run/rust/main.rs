mod auth;
mod cli;
mod cloudflare;
mod http;
mod paths;
mod search;
mod types;

use anyhow::Context;
use std::env;

const DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const DEFAULT_MODEL: &str = "gpt-5.6-luna";
const DEFAULT_ORIGINATOR: &str = "codex_cli_rs";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = cli::parse_args()?;
    let auth = auth::read_codex_auth().await?;
    let client = http::build_codex_http_client()?;
    let model = args
        .model
        .clone()
        .or_else(|| env::var("PI_CODEX_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let request = search::build_search_request(&args, model);
    let url = http::codex_search_url();

    let response = client
        .post(&url)
        .headers(http::headers(&auth)?)
        .json(&request)
        .send()
        .await
        .with_context(|| format!("web_run search request failed for `{url}`"))?;

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
            anyhow::bail!("web_run search failed for `{url}`: HTTP 403 Cloudflare challenge");
        }
        if status.as_u16() == 404 && body.contains("\"Not Found\"") {
            anyhow::bail!(
                "web_run search failed for `{url}`: HTTP 404 Not Found (Codex endpoint unavailable for this account/backend)"
            );
        }
        anyhow::bail!("web_run search failed for `{url}`: HTTP {status} {body}");
    }

    let response = search::parse_search_response(&body)?;
    println!("{}", search::tool_output(response));
    Ok(())
}
