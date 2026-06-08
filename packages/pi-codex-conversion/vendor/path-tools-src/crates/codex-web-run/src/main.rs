mod types;

use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

use anyhow::Context;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{CONTENT_TYPE, HeaderMap, HeaderValue, USER_AGENT};
use serde::Deserialize;
use serde_json::json;
use types::{AllowedCaller, SearchCommands, SearchRequest, SearchResponse, SearchSettings};
use uuid::Uuid;

const DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const DEFAULT_MODEL: &str = "gpt-5.4-mini";
const DEFAULT_ORIGINATOR: &str = "codex_cli_rs";

static CHATGPT_CLOUDFLARE_COOKIE_STORE: LazyLock<Arc<ChatGptCloudflareCookieStore>> =
    LazyLock::new(|| Arc::new(ChatGptCloudflareCookieStore::default()));

#[derive(Debug, Default)]
struct ChatGptCloudflareCookieStore {
    jar: Jar,
}

impl CookieStore for ChatGptCloudflareCookieStore {
    fn set_cookies(
        &self,
        cookie_headers: &mut dyn Iterator<Item = &HeaderValue>,
        url: &reqwest::Url,
    ) {
        if !is_chatgpt_cookie_url(url) {
            return;
        }
        let mut cloudflare_cookie_headers =
            cookie_headers.filter(|header| is_allowed_cloudflare_set_cookie_header(header));
        self.jar.set_cookies(&mut cloudflare_cookie_headers, url);
    }

    fn cookies(&self, url: &reqwest::Url) -> Option<HeaderValue> {
        if is_chatgpt_cookie_url(url) {
            self.jar.cookies(url).and_then(only_cloudflare_cookies)
        } else {
            None
        }
    }
}

fn is_chatgpt_cookie_url(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    matches!(
        host,
        "chatgpt.com" | "chat.openai.com" | "chatgpt-staging.com"
    ) || host.ends_with(".chatgpt.com")
        || host.ends_with(".chatgpt-staging.com")
}

fn is_allowed_cloudflare_set_cookie_header(header: &HeaderValue) -> bool {
    header
        .to_str()
        .ok()
        .and_then(|value| value.split_once('=').map(|(name, _)| name.trim()))
        .is_some_and(is_allowed_cloudflare_cookie_name)
}

fn only_cloudflare_cookies(header: HeaderValue) -> Option<HeaderValue> {
    let header = header.to_str().ok()?;
    let cookies = header
        .split(';')
        .filter_map(|cookie| {
            let cookie = cookie.trim();
            let name = cookie.split_once('=')?.0.trim();
            is_allowed_cloudflare_cookie_name(name).then_some(cookie)
        })
        .collect::<Vec<_>>()
        .join("; ");
    if cookies.is_empty() {
        None
    } else {
        HeaderValue::from_str(&cookies).ok()
    }
}

fn is_allowed_cloudflare_cookie_name(name: &str) -> bool {
    matches!(
        name,
        "__cf_bm"
            | "__cflb"
            | "__cfruid"
            | "__cfseq"
            | "__cfwaitingroom"
            | "_cfuvid"
            | "cf_clearance"
            | "cf_ob_info"
            | "cf_use_ob"
    ) || name.starts_with("cf_chl_")
}

#[derive(Debug, Deserialize)]
struct PiAuthFile {
    #[serde(rename = "openai-codex")]
    openai_codex: Option<PiOAuthCredential>,
}

#[derive(Debug, Deserialize)]
struct PiOAuthCredential {
    access: String,
    refresh: Option<String>,
    expires: Option<u64>,
    #[serde(rename = "accountId")]
    account_id: String,
}

struct CodexAuth {
    token: String,
    account_id: String,
}

#[derive(Debug, Deserialize)]
struct TokenRefreshResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn token_needs_refresh(credential: &PiOAuthCredential) -> bool {
    credential
        .expires
        .is_some_and(|expires| expires <= now_ms().saturating_add(60_000))
}

async fn refresh_pi_codex_auth(
    auth_path: &PathBuf,
    auth_json: &mut serde_json::Value,
    credential: &PiOAuthCredential,
) -> anyhow::Result<CodexAuth> {
    let Some(refresh_token) = credential
        .refresh
        .as_deref()
        .filter(|token| !token.trim().is_empty())
    else {
        anyhow::bail!(
            "Pi openai-codex credential access token is expired and no refresh token is available; run /login openai-codex"
        );
    };
    let response = build_codex_http_client()?
        .post("https://auth.openai.com/oauth/token")
        .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
        .json(&json!({
            "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .context("failed to refresh Pi openai-codex token")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read Pi openai-codex token refresh response")?;
    if !status.is_success() {
        anyhow::bail!("Pi openai-codex token refresh failed: HTTP {status} {body}");
    }
    let refreshed: TokenRefreshResponse = serde_json::from_str(&body)
        .context("failed to decode Pi openai-codex token refresh response")?;
    let new_refresh = refreshed
        .refresh_token
        .unwrap_or_else(|| refresh_token.to_string());
    let new_expires =
        now_ms().saturating_add(refreshed.expires_in.unwrap_or(0).saturating_mul(1_000));
    if let Some(entry) = auth_json
        .get_mut("openai-codex")
        .and_then(serde_json::Value::as_object_mut)
    {
        entry.insert(
            "access".to_string(),
            serde_json::Value::String(refreshed.access_token.clone()),
        );
        entry.insert(
            "refresh".to_string(),
            serde_json::Value::String(new_refresh),
        );
        if refreshed.expires_in.is_some() {
            entry.insert(
                "expires".to_string(),
                serde_json::Value::Number(new_expires.into()),
            );
        }
        fs::write(auth_path, serde_json::to_vec_pretty(auth_json)?).with_context(|| {
            format!(
                "failed to write refreshed Pi auth file `{}`",
                auth_path.display()
            )
        })?;
    }
    Ok(CodexAuth {
        token: refreshed.access_token,
        account_id: credential.account_id.clone(),
    })
}

#[derive(Debug, Deserialize)]
struct WebRunArgs {
    #[serde(flatten)]
    commands: SearchCommands,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
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

async fn read_codex_auth() -> anyhow::Result<CodexAuth> {
    if let (Ok(token), Ok(account_id)) = (
        env::var("PI_CODEX_ACCESS_TOKEN"),
        env::var("PI_CODEX_ACCOUNT_ID"),
    ) {
        return Ok(CodexAuth { token, account_id });
    }
    let auth_path = env::var("PI_AUTH_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| pi_agent_dir().join("auth.json"));
    let auth_file = fs::read_to_string(&auth_path)
        .with_context(|| format!("failed to read Pi auth file `{}`", auth_path.display()))?;
    let mut auth_json: serde_json::Value = serde_json::from_str(&auth_file)
        .with_context(|| format!("failed to parse Pi auth file `{}`", auth_path.display()))?;
    let auth: PiAuthFile = serde_json::from_value(auth_json.clone())
        .with_context(|| format!("failed to parse Pi auth file `{}`", auth_path.display()))?;
    let Some(credential) = auth.openai_codex else {
        anyhow::bail!(
            "Pi auth file `{}` has no openai-codex credential; run /login openai-codex",
            auth_path.display()
        );
    };
    if credential.access.is_empty() || credential.account_id.is_empty() {
        anyhow::bail!(
            "Pi openai-codex credential is missing access token or account id; run /login openai-codex"
        );
    }
    if token_needs_refresh(&credential) {
        return refresh_pi_codex_auth(&auth_path, &mut auth_json, &credential).await;
    }
    Ok(CodexAuth {
        token: credential.access,
        account_id: credential.account_id,
    })
}

fn alpha_search_url() -> String {
    if let Ok(url) = env::var("PI_CODEX_ALPHA_SEARCH_URL") {
        return alpha_search_url_from_base(&url);
    }
    if let Ok(base) = env::var("PI_CODEX_ALPHA_BASE_URL") {
        return alpha_search_url_from_base(&base);
    }
    if let Ok(server_uri) = env::var("PI_CODEX_SERVER_URI") {
        return format!(
            "{}/api/codex/alpha/search",
            server_uri.trim_end_matches('/')
        );
    }
    let base = env::var("PI_CODEX_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    alpha_search_url_from_base(&base)
}

fn alpha_search_url_from_base(base: &str) -> String {
    let normalized = base.trim_end_matches('/');
    if normalized.ends_with("/alpha/search") {
        normalized.to_string()
    } else if normalized.ends_with("/codex/responses") {
        format!("{}/alpha/search", normalized.trim_end_matches("/responses"))
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

fn headers(token: &str, account_id: &str) -> anyhow::Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {token}"))?,
    );
    headers.insert("ChatGPT-Account-ID", HeaderValue::from_str(account_id)?);
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
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

fn build_codex_http_client() -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .default_headers(default_headers())
        .cookie_provider(Arc::clone(&CHATGPT_CLOUDFLARE_COOKIE_STORE))
        .build()
        .context("failed to build web_run HTTP client")
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
    let auth = read_codex_auth().await?;
    let model = args
        .model
        .clone()
        .or_else(|| env::var("PI_CODEX_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let request = build_search_request(&args, model);
    let url = alpha_search_url();

    let response = build_codex_http_client()?
        .post(&url)
        .headers(headers(&auth.token, &auth.account_id)?)
        .json(&request)
        .send()
        .await
        .with_context(|| format!("web_run alpha/search request failed for `{url}`"))?;

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
            anyhow::bail!("web_run alpha/search failed for `{url}`: HTTP 403 Cloudflare challenge");
        }
        if status.as_u16() == 404 && body.contains("\"Not Found\"") {
            anyhow::bail!(
                "web_run alpha/search failed for `{url}`: HTTP 404 Not Found (Codex alpha/search endpoint unavailable for this account/backend)"
            );
        }
        anyhow::bail!("web_run alpha/search failed for `{url}`: HTTP {status} {body}");
    }
    if !body.trim_start().starts_with('{') {
        let lower_body = body.to_ascii_lowercase();
        if cloudflare_challenge || lower_body.contains("cloudflare") {
            anyhow::bail!("web_run alpha/search failed for `{url}`: Cloudflare challenge");
        }
        if lower_body.contains("<!doctype html") && lower_body.contains("chatgpt") {
            anyhow::bail!("web_run alpha/search failed for `{url}`: ChatGPT auth redirect");
        }
        anyhow::bail!("web_run alpha/search failed for `{url}`: expected JSON response");
    }

    let parsed: SearchResponse =
        serde_json::from_str(&body).context("failed to decode web_run alpha/search response")?;
    println!(
        "{}",
        json!({
            "text": "[encrypted web search output]",
            "encrypted_output": parsed.encrypted_output,
        })
    );
    Ok(())
}
