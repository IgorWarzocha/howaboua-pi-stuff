use std::env;
use std::sync::Arc;

use anyhow::Context;
use reqwest::header::{CONTENT_TYPE, HeaderMap, HeaderValue, USER_AGENT};

use crate::auth::CodexAuth;
use crate::cloudflare::CHATGPT_CLOUDFLARE_COOKIE_STORE;
use crate::{DEFAULT_BASE_URL, DEFAULT_ORIGINATOR};

pub fn codex_search_url() -> String {
    if let Ok(url) = env::var("PI_CODEX_SEARCH_URL") {
        return url;
    }
    let base = env::var("PI_CODEX_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    search_url_from_base(&base)
}

pub fn search_url_from_base(base: &str) -> String {
    let normalized = base.trim_end_matches('/');
    if normalized.ends_with("/alpha/search") {
        normalized.to_string()
    } else if let Some(base) = normalized.strip_suffix("/responses") {
        format!("{base}/alpha/search")
    } else if normalized.ends_with("/api/codex")
        || normalized.ends_with("/backend-api/codex")
        || normalized.ends_with("/codex")
    {
        format!("{normalized}/alpha/search")
    } else if normalized.ends_with("/api") || normalized.ends_with("/backend-api") {
        format!("{normalized}/codex/alpha/search")
    } else {
        format!("{normalized}/api/codex/alpha/search")
    }
}

pub fn headers(auth: &CodexAuth) -> anyhow::Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "Authorization",
        HeaderValue::from_str(&auth.authorization_header()?)?,
    );
    headers.insert(
        "ChatGPT-Account-ID",
        HeaderValue::from_str(auth.account_id())?,
    );
    if auth.is_fedramp_account() {
        headers.insert("X-OpenAI-Fedramp", HeaderValue::from_static("true"));
    }
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
}

#[cfg(test)]
mod tests {
    use super::search_url_from_base;

    #[test]
    fn derives_native_search_endpoint_from_supported_provider_bases() {
        assert_eq!(
            search_url_from_base("https://chatgpt.com/backend-api/codex"),
            "https://chatgpt.com/backend-api/codex/alpha/search"
        );
        assert_eq!(
            search_url_from_base("https://proxy.example/api/codex/responses"),
            "https://proxy.example/api/codex/alpha/search"
        );
        assert_eq!(
            search_url_from_base("https://proxy.example/api/codex/alpha/search"),
            "https://proxy.example/api/codex/alpha/search"
        );
    }
}

fn default_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    let originator = env::var("CODEX_INTERNAL_ORIGINATOR_OVERRIDE")
        .unwrap_or_else(|_| DEFAULT_ORIGINATOR.to_string());
    if let Ok(value) = HeaderValue::from_str(&originator) {
        headers.insert("originator", value);
    } else {
        headers.insert("originator", HeaderValue::from_static(DEFAULT_ORIGINATOR));
    }
    if let Ok(value) = HeaderValue::from_str(&codex_user_agent(&originator)) {
        headers.insert(USER_AGENT, value);
    }
    headers.insert("version", HeaderValue::from_static("0.0.0"));
    headers
}

fn codex_user_agent(originator: &str) -> String {
    let terminal = env::var("TERM_PROGRAM")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var("TERM")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| "unknown".to_string());
    let os_info = os_info::get();
    format!(
        "{originator}/0.0.0 ({} {}; {}) {terminal}",
        os_info.os_type(),
        os_info.version(),
        os_info.architecture().unwrap_or("unknown")
    )
}

pub fn build_codex_http_client() -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .default_headers(default_headers())
        .cookie_provider(Arc::clone(&CHATGPT_CLOUDFLARE_COOKIE_STORE))
        .build()
        .context("failed to build web_run HTTP client")
}
