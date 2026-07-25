use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

use anyhow::Context;
use base64::Engine;
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD};
use chrono::{SecondsFormat, Utc};
use crypto_box::SecretKey as Curve25519SecretKey;
use ed25519_dalek::pkcs8::DecodePrivateKey;
use ed25519_dalek::{Signer as _, SigningKey};
use reqwest::header::{CONTENT_TYPE, HeaderValue};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest as _, Sha512};

use crate::http::build_codex_http_client;
use crate::paths::pi_agent_dir;

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

pub enum CodexAuth {
    Bearer { token: String, account_id: String },
    AgentIdentity(AgentIdentityAuth),
}

impl CodexAuth {
    pub fn account_id(&self) -> &str {
        match self {
            Self::Bearer { account_id, .. } => account_id,
            Self::AgentIdentity(auth) => &auth.record.account_id,
        }
    }

    pub fn is_fedramp_account(&self) -> bool {
        match self {
            Self::Bearer { .. } => false,
            Self::AgentIdentity(auth) => auth.record.chatgpt_account_is_fedramp,
        }
    }

    pub fn authorization_header(&self) -> anyhow::Result<String> {
        match self {
            Self::Bearer { token, .. } => Ok(format!("Bearer {token}")),
            Self::AgentIdentity(auth) => auth.authorization_header(),
        }
    }
}

pub(crate) struct AgentIdentityAuth {
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
    pub fn authorization_header(&self) -> anyhow::Result<String> {
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

pub async fn read_codex_auth() -> anyhow::Result<CodexAuth> {
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
