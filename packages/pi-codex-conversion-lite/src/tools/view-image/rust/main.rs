use std::env;
use std::io::Read;
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

fn parse_args() -> anyhow::Result<ViewImageArgs> {
    let mut args = env::args().skip(1);
    let input = match args.next() {
        None => {
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .context("failed to read view_image JSON arguments from stdin")?;
            stdin
        }
        Some(first) if first == "-" => {
            if args.next().is_some() {
                anyhow::bail!("view_image accepts a single JSON argument or stdin");
            }
            let mut stdin = String::new();
            std::io::stdin()
                .read_to_string(&mut stdin)
                .context("failed to read view_image JSON arguments from stdin")?;
            stdin
        }
        Some(first) => {
            if args.next().is_some() {
                anyhow::bail!("view_image accepts a single JSON argument or stdin");
            }
            first
        }
    };
    if input.trim().is_empty() {
        anyhow::bail!("view_image requires JSON arguments");
    }
    serde_json::from_str(input.trim()).context("failed to parse view_image JSON arguments")
}

fn main() -> anyhow::Result<()> {
    let ViewImageArgs { path, detail } = parse_args()?;
    match detail.as_deref() {
        None | Some("original") => {}
        Some(detail) => anyhow::bail!(
            "view_image.detail only supports `original`, got `{detail}`"
        ),
    }

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
    let image = load_for_prompt_bytes(abs_path.as_path(), file_bytes, PromptImageMode::Original)
        .with_context(|| format!("unable to process image at `{}`", abs_path.display()))?;
    println!("{}", json!({ "image_url": image.into_data_url(), "detail": "original" }));
    Ok(())
}
