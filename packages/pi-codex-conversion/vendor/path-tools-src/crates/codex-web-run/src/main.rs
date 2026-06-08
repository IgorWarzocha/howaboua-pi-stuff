mod types;

use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

use anyhow::Context;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::SecondsFormat;
use chrono::Utc;
use crypto_box::SecretKey as Curve25519SecretKey;
use ed25519_dalek::Signer as _;
use ed25519_dalek::SigningKey;
use ed25519_dalek::pkcs8::DecodePrivateKey;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderValue, USER_AGENT};
use serde::Deserialize;
use serde_json::json;
use sha2::Digest as _;
use sha2::Sha512;
use types::{SearchCommands, SearchSettings};

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
    #[serde(default)]
    agent_identity: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PiOAuthCredential {
    access: String,
    refresh: Option<String>,
    expires: Option<u64>,
    #[serde(rename = "accountId")]
    account_id: String,
}

enum CodexAuth {
    Bearer { token: String, account_id: String },
    AgentIdentity(AgentIdentityAuth),
}

impl CodexAuth {
    fn account_id(&self) -> &str {
        match self {
            Self::Bearer { account_id, .. } => account_id,
            Self::AgentIdentity(auth) => &auth.record.account_id,
        }
    }

    fn is_fedramp_account(&self) -> bool {
        match self {
            Self::Bearer { .. } => false,
            Self::AgentIdentity(auth) => auth.record.chatgpt_account_is_fedramp,
        }
    }

    fn authorization_header(&self) -> anyhow::Result<String> {
        match self {
            Self::Bearer { token, .. } => Ok(format!("Bearer {token}")),
            Self::AgentIdentity(auth) => auth.authorization_header(),
        }
    }
}

struct AgentIdentityAuth {
    record: AgentIdentityAuthRecord,
    process_task_id: String,
}

#[derive(Debug, Deserialize)]
struct AgentIdentityAuthRecord {
    agent_runtime_id: String,
    agent_private_key: String,
    account_id: String,
    #[serde(default)]
    chatgpt_account_is_fedramp: bool,
}

#[derive(Deserialize)]
struct RegisterTaskResponse {
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default, rename = "taskId")]
    task_id_camel: Option<String>,
    #[serde(default)]
    encrypted_task_id: Option<String>,
    #[serde(default, rename = "encryptedTaskId")]
    encrypted_task_id_camel: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenRefreshResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    id_token: Option<String>,
}

fn account_id_from_jwt(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("chatgpt_account_id")
        .and_then(serde_json::Value::as_str)
        .filter(|account_id| !account_id.trim().is_empty())
        .map(str::to_string)
}

fn agent_identity_record_from_jwt(jwt: &str) -> anyhow::Result<AgentIdentityAuthRecord> {
    let payload = jwt
        .split('.')
        .nth(1)
        .context("agent identity JWT is missing payload")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .context("agent identity JWT payload is not valid base64url")?;
    serde_json::from_slice(&bytes).context("agent identity JWT payload is not valid JSON")
}

fn signing_key_from_private_key_pkcs8_base64(
    private_key_pkcs8_base64: &str,
) -> anyhow::Result<SigningKey> {
    let private_key = BASE64_STANDARD
        .decode(private_key_pkcs8_base64)
        .context("stored agent identity private key is not valid base64")?;
    SigningKey::from_pkcs8_der(&private_key)
        .context("stored agent identity private key is not valid PKCS#8")
}

fn curve25519_secret_key_from_signing_key(signing_key: &SigningKey) -> Curve25519SecretKey {
    let digest = Sha512::digest(signing_key.to_bytes());
    let mut secret_key = [0u8; 32];
    secret_key.copy_from_slice(&digest[..32]);
    secret_key[0] &= 248;
    secret_key[31] &= 127;
    secret_key[31] |= 64;
    Curve25519SecretKey::from(secret_key)
}

fn sign_agent_identity_payload(
    record: &AgentIdentityAuthRecord,
    payload: &str,
) -> anyhow::Result<String> {
    let signing_key = signing_key_from_private_key_pkcs8_base64(&record.agent_private_key)?;
    Ok(BASE64_STANDARD.encode(signing_key.sign(payload.as_bytes()).to_bytes()))
}

fn decrypt_task_id_response(
    record: &AgentIdentityAuthRecord,
    encrypted_task_id: &str,
) -> anyhow::Result<String> {
    let signing_key = signing_key_from_private_key_pkcs8_base64(&record.agent_private_key)?;
    let ciphertext = BASE64_STANDARD
        .decode(encrypted_task_id)
        .context("encrypted task id is not valid base64")?;
    let plaintext = curve25519_secret_key_from_signing_key(&signing_key)
        .unseal(&ciphertext)
        .map_err(|_| anyhow::anyhow!("failed to decrypt encrypted task id"))?;
    String::from_utf8(plaintext).context("decrypted task id is not valid UTF-8")
}

async fn load_agent_identity_auth(jwt: &str) -> anyhow::Result<AgentIdentityAuth> {
    let record = agent_identity_record_from_jwt(jwt)?;
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let signature =
        sign_agent_identity_payload(&record, &format!("{}:{timestamp}", record.agent_runtime_id))?;
    let base_url = env::var("CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL")
        .unwrap_or_else(|_| "https://auth.openai.com/api/accounts".to_string());
    let url = format!(
        "{}/v1/agent/{}/task/register",
        base_url.trim_end_matches('/'),
        record.agent_runtime_id
    );
    let response = build_codex_http_client()?
        .post(url)
        .json(&json!({ "timestamp": timestamp, "signature": signature }))
        .send()
        .await
        .context("failed to register agent identity task")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read agent identity task registration response")?;
    if !status.is_success() {
        anyhow::bail!("agent identity task registration failed: HTTP {status} {body}");
    }
    let parsed: RegisterTaskResponse = serde_json::from_str(&body)
        .context("failed to decode agent identity task registration response")?;
    let process_task_id = if let Some(task_id) = parsed.task_id.or(parsed.task_id_camel) {
        task_id
    } else {
        let encrypted = parsed
            .encrypted_task_id
            .or(parsed.encrypted_task_id_camel)
            .context("agent task registration response omitted task id")?;
        decrypt_task_id_response(&record, &encrypted)?
    };
    Ok(AgentIdentityAuth {
        record,
        process_task_id,
    })
}

impl AgentIdentityAuth {
    fn authorization_header(&self) -> anyhow::Result<String> {
        let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let signature = sign_agent_identity_payload(
            &self.record,
            &format!(
                "{}:{}:{timestamp}",
                self.record.agent_runtime_id, self.process_task_id
            ),
        )?;
        let assertion = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&BTreeMap::from([
            ("agent_runtime_id", self.record.agent_runtime_id.as_str()),
            ("signature", signature.as_str()),
            ("task_id", self.process_task_id.as_str()),
            ("timestamp", timestamp.as_str()),
        ]))?);
        Ok(format!("AgentAssertion {assertion}"))
    }
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
    let refreshed_account_id = refreshed
        .id_token
        .as_deref()
        .and_then(account_id_from_jwt)
        .unwrap_or_else(|| credential.account_id.clone());
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
        entry.insert(
            "accountId".to_string(),
            serde_json::Value::String(refreshed_account_id.clone()),
        );
        fs::write(auth_path, serde_json::to_vec_pretty(auth_json)?).with_context(|| {
            format!(
                "failed to write refreshed Pi auth file `{}`",
                auth_path.display()
            )
        })?;
    }
    Ok(CodexAuth::Bearer {
        token: refreshed.access_token,
        account_id: refreshed_account_id,
    })
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct WebRunArgs {
    #[serde(default)]
    id: Option<String>,
    #[serde(flatten)]
    commands: SearchCommands,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning: Option<serde_json::Value>,
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
    if let Ok(jwt) = env::var("PI_CODEX_AGENT_IDENTITY_JWT")
        && !jwt.trim().is_empty()
    {
        return Ok(CodexAuth::AgentIdentity(
            load_agent_identity_auth(&jwt).await?,
        ));
    }
    if let (Ok(token), Ok(account_id)) = (
        env::var("PI_CODEX_ACCESS_TOKEN"),
        env::var("PI_CODEX_ACCOUNT_ID"),
    ) {
        return Ok(CodexAuth::Bearer { token, account_id });
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
    if let Some(jwt) = auth
        .agent_identity
        .as_deref()
        .filter(|jwt| !jwt.trim().is_empty())
    {
        return Ok(CodexAuth::AgentIdentity(
            load_agent_identity_auth(jwt).await?,
        ));
    }
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
    Ok(CodexAuth::Bearer {
        token: credential.access,
        account_id: credential.account_id,
    })
}

fn codex_responses_url() -> String {
    if let Ok(url) = env::var("PI_CODEX_RESPONSES_URL") {
        return url;
    }
    let base = env::var("PI_CODEX_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    responses_url_from_base(&base)
}

fn responses_url_from_base(base: &str) -> String {
    let normalized = base.trim_end_matches('/');
    if normalized.ends_with("/codex/responses") {
        normalized.to_string()
    } else if normalized.ends_with("/api/codex")
        || normalized.ends_with("/backend-api/codex")
        || normalized.ends_with("/codex")
    {
        format!("{normalized}/responses")
    } else if normalized.ends_with("/api") || normalized.ends_with("/backend-api") {
        format!("{normalized}/codex/responses")
    } else {
        format!("{normalized}/api/codex/responses")
    }
}

fn headers(auth: &CodexAuth) -> anyhow::Result<HeaderMap> {
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
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    headers.insert("OpenAI-Beta", HeaderValue::from_static("responses=experimental"));
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

fn build_responses_web_search_request(args: &WebRunArgs, model: String) -> anyhow::Result<serde_json::Value> {
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

fn output_text_from_sse(body: &str) -> anyhow::Result<String> {
    let mut text = String::new();
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
        if event.get("type").and_then(serde_json::Value::as_str) == Some("response.output_text.delta")
            && let Some(delta) = event.get("delta").and_then(serde_json::Value::as_str)
        {
            text.push_str(delta);
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
    Ok(text)
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
    let request = build_responses_web_search_request(&args, model)?;
    let url = codex_responses_url();

    let response = build_codex_http_client()?
        .post(&url)
        .headers(headers(&auth)?)
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
            anyhow::bail!("web_run Responses web search failed for `{url}`: HTTP 403 Cloudflare challenge");
        }
        if status.as_u16() == 404 && body.contains("\"Not Found\"") {
            anyhow::bail!(
                "web_run Responses web search failed for `{url}`: HTTP 404 Not Found (Codex endpoint unavailable for this account/backend)"
            );
        }
        anyhow::bail!("web_run Responses web search failed for `{url}`: HTTP {status} {body}");
    }

    let text = output_text_from_sse(&body).context("failed to decode web_run Responses search response")?;
    println!(
        "{}",
        json!({
            "text": text,
            "output_text": text,
        })
    );
    Ok(())
}
