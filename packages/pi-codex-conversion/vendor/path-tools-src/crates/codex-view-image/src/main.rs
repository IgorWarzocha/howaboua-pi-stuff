use std::env;
use std::fs;
use std::path::PathBuf;

use anyhow::Context;
use codex_utils_image::{PromptImageMode, load_for_prompt_bytes};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct ViewImageArgs {
    path: String,
    detail: Option<String>,
}

enum ViewImageDetail {
    High,
    Original,
}

fn parse_args() -> anyhow::Result<ViewImageArgs> {
    let mut args = env::args().skip(1);
    let Some(first) = args.next() else {
        anyhow::bail!("view_image requires JSON arguments");
    };
    if args.next().is_some() {
        anyhow::bail!("view_image accepts a single JSON argument");
    }
    serde_json::from_str(&first).context("failed to parse view_image JSON arguments")
}

fn main() -> anyhow::Result<()> {
    let ViewImageArgs { path, detail } = parse_args()?;
    let detail = match detail.as_deref() {
        None => ViewImageDetail::High,
        Some("high") => ViewImageDetail::High,
        Some("original") => ViewImageDetail::Original,
        Some(detail) => anyhow::bail!(
            "view_image.detail only supports `high` or `original`; omit `detail` for default high resized behavior, got `{detail}`"
        ),
    };

    let path = PathBuf::from(path);
    let abs_path = if path.is_absolute() {
        path
    } else {
        env::current_dir()?.join(path)
    };
    let metadata = fs::metadata(&abs_path)
        .with_context(|| format!("unable to locate image at `{}`", abs_path.display()))?;
    if !metadata.is_file() {
        anyhow::bail!("image path `{}` is not a file", abs_path.display());
    }
    let file_bytes = fs::read(&abs_path)
        .with_context(|| format!("unable to read image at `{}`", abs_path.display()))?;
    let image_mode = match detail {
        ViewImageDetail::High => PromptImageMode::ResizeToFit,
        ViewImageDetail::Original => PromptImageMode::Original,
    };
    let image = load_for_prompt_bytes(abs_path.as_path(), file_bytes, image_mode)
        .with_context(|| format!("unable to process image at `{}`", abs_path.display()))?;
    let detail = match detail {
        ViewImageDetail::High => "high",
        ViewImageDetail::Original => "original",
    };
    println!("{}", json!({ "image_url": image.into_data_url(), "detail": detail }));
    Ok(())
}
