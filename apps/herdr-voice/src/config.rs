use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub port: u16,
    pub token: String,
}

pub fn directory() -> Result<PathBuf> {
    Ok(dirs::config_dir()
        .context("Cannot find the user configuration directory")?
        .join("herdr-voice"))
}

pub fn load() -> Result<Config> {
    let path = directory()?.join("companion.json");
    if !path.exists() {
        let config = Config {
            port: 43122,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        };
        fs::create_dir_all(path.parent().context("Missing configuration directory")?)?;
        private_write(&path, &serde_json::to_vec_pretty(&config)?, true)?;
        return Ok(config);
    }
    let config: Config = serde_json::from_slice(&fs::read(&path)?)
        .with_context(|| format!("Invalid configuration at {}", path.display()))?;
    if config.port == 0
        || config.token.len() != 64
        || !config.token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        bail!("Invalid companion port or token in {}", path.display());
    }
    Ok(config)
}

pub fn private_write(path: &Path, bytes: &[u8], new: bool) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true);
    if new {
        options.create_new(true);
    } else {
        options.create(true).truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("Cannot write {}", path.display()))?;
    file.write_all(bytes)?;
    Ok(())
}

pub fn install(config: &Config, home: Option<PathBuf>, indicator_mods: &[String]) -> Result<()> {
    let home = match home {
        Some(path) => path,
        None => std::env::var_os("HERDR_APP_HOME")
            .map(PathBuf::from)
            .unwrap_or(
                std::env::var_os("XDG_CONFIG_HOME")
                    .map(PathBuf::from)
                    .unwrap_or(
                        dirs::home_dir()
                            .context("Cannot find the user's home directory")?
                            .join(".config"),
                    )
                    .join("herdr-app"),
            ),
    };
    for name in indicator_mods {
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            bail!("Choose a personal cloned mod name for the voice indicator");
        }
        let target = home.join("mods").join(name);
        let meta: serde_json::Value = serde_json::from_slice(&fs::read(target.join("mod.json"))?)?;
        if !meta["cloned_from"].is_object() || !target.join("main.js").is_file() {
            bail!("Clone {name} in Herdr before installing a voice indicator");
        }
        let helper = target.join("voice-indicator.js");
        if helper.exists()
            && !fs::read_to_string(&helper)?.starts_with("// herdr-voice-managed-indicator v1\n")
        {
            bail!(
                "An unrelated voice-indicator.js already exists in {name}; move it before installing the indicator"
            );
        }
    }
    let directory = home.join("mods/voice");
    if directory.exists()
        && !fs::read_to_string(directory.join("indicator.js"))
            .is_ok_and(|content| content.starts_with("// herdr-voice-managed-indicator v1\n"))
    {
        bail!(
            "A different mod already occupies {}; choose another Herdr home",
            directory.display()
        );
    }
    fs::create_dir_all(&directory)?;
    fs::create_dir_all(directory.join("icons"))?;
    for (name, content) in [
        ("main.js", include_str!("../mod/main.js")),
        ("companion.js", include_str!("../mod/companion.js")),
        ("sidebar.js", include_str!("../mod/sidebar.js")),
        ("settings.js", include_str!("../mod/settings.js")),
        ("host-settings.js", include_str!("../mod/host-settings.js")),
        ("select.js", include_str!("../mod/select.js")),
        ("state.js", include_str!("../mod/state.js")),
        ("ui.js", include_str!("../mod/ui.js")),
        ("indicator.js", include_str!("../mod/indicator.js")),
        ("mod.json", include_str!("../mod/mod.json")),
        ("icons/zap.svg", include_str!("../mod/icons/zap.svg")),
        ("icons/plug.svg", include_str!("../mod/icons/plug.svg")),
        ("icons/mic.svg", include_str!("../mod/icons/mic.svg")),
        (
            "icons/mic-off.svg",
            include_str!("../mod/icons/mic-off.svg"),
        ),
        (
            "icons/disconnect.svg",
            include_str!("../mod/icons/disconnect.svg"),
        ),
    ] {
        fs::write(directory.join(name), content)?;
    }
    private_write(
        &directory.join("companion.json"),
        &serde_json::to_vec_pretty(&serde_json::json!({
            "endpoint": format!("http://127.0.0.1:{}", config.port), "token": config.token,
        }))?,
        false,
    )?;
    for name in indicator_mods {
        fs::write(
            home.join("mods").join(name).join("voice-indicator.js"),
            include_str!("../mod/indicator.js"),
        )?;
    }
    println!(
        "Installed {}. Run herdr-voice serve on this machine; open the voice mod in Herdr.",
        directory.display()
    );
    Ok(())
}
