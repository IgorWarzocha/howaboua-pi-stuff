mod audio;
mod config;
mod connection;
mod control;
mod launch;
mod session;
mod wire;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    version,
    about = "Local microphone and speakers for remote Pi, controlled from Herdr"
)]
struct Cli {
    #[command(subcommand)]
    command: Action,
}

#[derive(Subcommand)]
enum Action {
    /// Run the local companion; no microphone opens until Connect.
    Serve,
    /// Install the native voice panel into Herdr.
    InstallMod {
        #[arg(long)]
        herdr_home: Option<PathBuf>,
        /// Install the indicator helper into a personal cloned mod.
        #[arg(long)]
        indicator_mod: Vec<String>,
    },
    /// Show current connection state.
    Status,
    /// Enumerate local microphones and speakers without starting a call.
    Devices,
    /// Disconnect local audio without ending the remote Pi call.
    Disconnect,
    /// Set microphone mute while keeping the connection.
    Mute { muted: bool },
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    let config = config::load()?;
    match cli.command {
        Action::Serve => control::serve(config).await?,
        Action::InstallMod {
            herdr_home,
            indicator_mod,
        } => config::install(&config, herdr_home, &indicator_mod)?,
        Action::Devices => println!(
            "{}",
            serde_json::to_string_pretty(&audio::devices().await?)?
        ),
        command => {
            let client = reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(15))
                .build()?;
            let (path, body) = match command {
                Action::Status => ("status", None),
                Action::Disconnect => ("disconnect", Some(serde_json::json!({}))),
                Action::Mute { muted } => ("mute", Some(serde_json::json!({"muted":muted}))),
                _ => unreachable!(),
            };
            let url = format!("http://127.0.0.1:{}/{path}", config.port);
            let request = match body {
                Some(body) => client.post(url).json(&body),
                None => client.get(url),
            };
            let response = request
                .bearer_auth(&config.token)
                .send()
                .await
                .context("Cannot reach the local companion; run herdr-voice serve")?;
            let status = response.status();
            let value: serde_json::Value = response.json().await?;
            anyhow::ensure!(
                status.is_success(),
                "{}",
                value["error"]
                    .as_str()
                    .unwrap_or("Companion request failed")
            );
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
    }
    Ok(())
}
