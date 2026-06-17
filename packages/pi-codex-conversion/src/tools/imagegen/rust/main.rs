use std::io::Read;
use std::path::{Path, PathBuf};
use std::{env, fs};

use anyhow::Context;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

const DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api";
const IMAGE_DIR: &str = ".pi/openai-codex-images";
const LATEST_IMAGE_NAME: &str = "latest.png";
const IMAGE_MODEL: &str = "gpt-image-2";

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
#[serde(rename_all = "lowercase")]
enum ImagegenAction {
    Generate,
    Edit,
}

fn default_action() -> ImagegenAction {
    ImagegenAction::Generate
}

#[derive(Debug, Deserialize)]
struct ImagegenArgs {
    prompt: String,
    #[serde(default = "default_action")]
    action: ImagegenAction,
    #[serde(default)]
    images: Vec<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ImageBackground {
    Transparent,
    Opaque,
    Auto,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ImageQuality {
    Low,
    Medium,
    High,
    Auto,
}

#[derive(Debug, Deserialize)]
struct ImageResponse {
    data: Vec<ImageData>,
    #[serde(default)]
    background: Option<ImageBackground>,
    #[serde(default)]
    quality: Option<ImageQuality>,
    #[serde(default)]
    size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImageData {
    b64_json: String,
}

#[derive(Debug, Serialize)]
struct SavedImage {
    path: String,
    absolute_path: String,
    latest_path: String,
    latest_absolute_path: String,
}

#[derive(Debug, Serialize)]
struct ImagegenOutput {
    path: String,
    latest_path: String,
    images: Vec<SavedImage>,
    background: Option<ImageBackground>,
    quality: Option<ImageQuality>,
    size: Option<String>,
}

fn parse_args() -> anyhow::Result<ImagegenArgs> {
    let mut args = env::args().skip(1);
    let input = match args.next() {
        None => {
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .context("failed to read imagegen JSON arguments from stdin")?;
            stdin
        }
        Some(first) if first == "-" => {
            if args.next().is_some() {
                anyhow::bail!("imagegen accepts a single JSON argument or stdin");
            }
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .context("failed to read imagegen JSON arguments from stdin")?;
            stdin
        }
        Some(first) => {
            if args.next().is_some() {
                anyhow::bail!("imagegen accepts a single JSON argument or stdin");
            }
            first
        }
    };
    if input.trim().is_empty() {
        anyhow::bail!("imagegen requires JSON arguments");
    }
    serde_json::from_str(input.trim()).context("failed to parse imagegen JSON arguments")
}

fn pi_agent_dir() -> PathBuf {
    if let Ok(path) = env::var("PI_CODING_AGENT_DIR") {
        return PathBuf::from(path);
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".pi").join("agent")
}

fn read_codex_auth() -> anyhow::Result<CodexAuth> {
    if let (Ok(token), Ok(account_id)) = (
        env::var("PI_CODEX_ACCESS_TOKEN"),
        env::var("PI_CODEX_ACCOUNT_ID"),
    ) {
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
    Ok(CodexAuth {
        token: credential.access,
        account_id: credential.account_id,
    })
}

fn headers(token: &str, account_id: &str) -> anyhow::Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {token}"))?,
    );
    headers.insert("chatgpt-account-id", HeaderValue::from_str(account_id)?);
    headers.insert("originator", HeaderValue::from_static("codex_cli_rs"));
    headers.insert("accept", HeaderValue::from_static("application/json"));
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    headers.insert("version", HeaderValue::from_static("0.0.0"));
    headers.insert(
        "User-Agent",
        HeaderValue::from_static("pi-codex-conversion imagegen path-tool"),
    );
    Ok(headers)
}

fn workspace_root(cwd: &Path) -> PathBuf {
    let mut current = cwd.to_path_buf();
    loop {
        if current.join(".git").exists() {
            return current;
        }
        let Some(parent) = current.parent() else {
            return cwd.to_path_buf();
        };
        if parent == current {
            return cwd.to_path_buf();
        }
        current = parent.to_path_buf();
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}

fn image_url_from_arg(value: &str) -> anyhow::Result<String> {
    if value.starts_with("data:image/")
        || value.starts_with("http://")
        || value.starts_with("https://")
    {
        return Ok(value.to_string());
    }
    let bytes = fs::read(value).with_context(|| format!("failed to read edit image `{value}`"))?;
    let mime = mime_guess::from_path(value)
        .first_or_octet_stream()
        .to_string();
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

fn codex_base_url() -> String {
    let base = env::var("PI_CODEX_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    let normalized = base.trim_end_matches('/');
    if let Ok(url) = reqwest::Url::parse(normalized) {
        if url.path().is_empty() || url.path() == "/" {
            return format!("{normalized}/api/codex");
        }
    }
    if normalized.ends_with("/codex/responses") {
        normalized.trim_end_matches("/responses").to_string()
    } else if normalized.ends_with("/codex") {
        normalized.to_string()
    } else if normalized.ends_with("/backend-api") || normalized.ends_with("/api") {
        format!("{normalized}/codex")
    } else {
        normalized.to_string()
    }
}

fn image_endpoint_url(action: &ImagegenAction) -> String {
    let operation = match action {
        ImagegenAction::Generate => "generations",
        ImagegenAction::Edit => "edits",
    };
    format!("{}/images/{operation}", codex_base_url())
}

fn build_request(args: &ImagegenArgs) -> anyhow::Result<serde_json::Value> {
    let model = args
        .model
        .clone()
        .unwrap_or_else(|| IMAGE_MODEL.to_string());
    match args.action {
        ImagegenAction::Generate => Ok(json!({
            "prompt": args.prompt,
            "model": model,
            "background": "auto",
            "quality": "auto",
            "size": "auto",
        })),
        ImagegenAction::Edit => {
            if args.images.is_empty() {
                anyhow::bail!("image edit requires an images array of paths or image URLs");
            }
            let mut images = Vec::with_capacity(args.images.len());
            for image in &args.images {
                images.push(json!({ "image_url": image_url_from_arg(image)? }));
            }
            Ok(json!({
                "images": images,
                "prompt": args.prompt,
                "model": model,
                "background": "auto",
                "quality": "auto",
                "size": "auto",
            }))
        }
    }
}

fn save_images(args: &ImagegenArgs, response: ImageResponse) -> anyhow::Result<ImagegenOutput> {
    let cwd = args
        .cwd
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or(env::current_dir().context("failed to read current directory")?);
    let root = workspace_root(&cwd);
    let out_dir = root.join(IMAGE_DIR);
    fs::create_dir_all(&out_dir)
        .with_context(|| format!("failed to create `{}`", out_dir.display()))?;

    let latest = out_dir.join(LATEST_IMAGE_NAME);
    let mut saved = Vec::new();
    for (index, data) in response.data.into_iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.b64_json.as_bytes())
            .context("failed to decode image response")?;
        let name = if index == 0 {
            format!("ig_{}.png", Uuid::new_v4().simple())
        } else {
            format!("ig_{}_{}.png", Uuid::new_v4().simple(), index + 1)
        };
        let path = out_dir.join(name);
        fs::write(&path, &bytes)
            .with_context(|| format!("failed to write `{}`", path.display()))?;
        if index == 0 {
            fs::write(&latest, &bytes)
                .with_context(|| format!("failed to write `{}`", latest.display()))?;
        }
        saved.push(SavedImage {
            path: relative_path(&root, &path),
            absolute_path: path.to_string_lossy().to_string(),
            latest_path: relative_path(&root, &latest),
            latest_absolute_path: latest.to_string_lossy().to_string(),
        });
    }
    if saved.is_empty() {
        anyhow::bail!("image generation returned no image data");
    }
    Ok(ImagegenOutput {
        path: saved[0].path.clone(),
        latest_path: saved[0].latest_path.clone(),
        images: saved,
        background: response.background,
        quality: response.quality,
        size: response.size,
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args()?;
    let auth = read_codex_auth()?;
    let body = build_request(&args)?;
    let response = reqwest::Client::new()
        .post(image_endpoint_url(&args.action))
        .headers(headers(&auth.token, &auth.account_id)?)
        .json(&body)
        .send()
        .await
        .context("image generation request failed")?;
    let status = response.status();
    let text = response
        .text()
        .await
        .context("failed to read image generation response")?;
    if !status.is_success() {
        anyhow::bail!("image generation failed: HTTP {status} {text}");
    }
    let image_response: ImageResponse =
        serde_json::from_str(&text).context("failed to decode image generation response")?;
    let output = save_images(&args, image_response)?;
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}
