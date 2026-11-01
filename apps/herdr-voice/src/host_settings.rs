use crate::{
    connection::{Connection, Provider},
    launch::{self, Prepare, Prepared},
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::time::Duration;

const OPENAI_KEYS: &[&str] = &[
    "model",
    "apiProvider",
    "realtimeVoice",
    "realtimeAlternateVoice",
    "v3Voice",
    "v3AlternateVoice",
    "contextModel",
    "contextReasoning",
    "taskDelegationReasoning",
    "webSearch",
    "autoResumeRealtime",
    "refreshRealtimeAfterCompaction",
    "delegationAcknowledgements",
    "forwardReasoningSummaries",
];
const GROK_KEYS: &[&str] = &[
    "voice",
    "alternateVoice",
    "model",
    "reasoning",
    "webSearch",
    "autoResume",
    "contextModel",
    "contextReasoning",
    "speed",
    "language",
    "silenceSeconds",
];

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    provider: Provider,
    terminal: String,
    #[serde(default)]
    ssh_host: String,
}

impl Target {
    fn prepare(&self) -> Result<Prepare> {
        ensure!(
            !self.terminal.trim().is_empty(),
            "Select an existing Pi pane to edit host settings"
        );
        Ok(Prepare {
            provider: self.provider,
            terminal: Some(self.terminal.clone()),
            machine: None,
            ssh_host: self.ssh_host.clone(),
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Save {
    provider: Provider,
    terminal: String,
    #[serde(default)]
    ssh_host: String,
    identity: String,
    patch: Map<String, Value>,
}

// One loaded editor per companion. Tokens never authorize arbitrary URLs or certificates.
pub struct Loaded {
    token: String,
    target: Target,
    prepared: Prepared,
}

pub async fn load(target: Target) -> Result<(Loaded, Value)> {
    let prepared = launch::prepare(target.prepare()?).await?;
    let snapshot = exchange(&prepared, None).await?;
    let loaded = Loaded {
        token: uuid::Uuid::new_v4().to_string(),
        target,
        prepared,
    };
    let response = normalize(&loaded, snapshot)?;
    Ok((loaded, response))
}

pub async fn save(loaded: &Loaded, request: Save) -> Result<Value> {
    let target = Target {
        provider: request.provider,
        terminal: request.terminal,
        ssh_host: request.ssh_host,
    };
    ensure!(
        request.identity == loaded.token && target == loaded.target,
        "Host settings target changed or expired; reload settings before saving"
    );
    ensure!(!request.patch.is_empty(), "No host settings were changed");
    let keys = editable(loaded.prepared.connect.provider);
    ensure!(
        request.patch.keys().all(|key| keys.contains(&key.as_str())),
        "This patch contains unsupported host settings; reload settings and use the available controls"
    );
    // Check before preparing: a replaced pane must not even receive a mailbox request.
    launch::verify_identity(&loaded.prepared.terminal, &loaded.prepared.identity).await?;
    let fresh = launch::prepare(target.prepare()?).await?;
    ensure!(
        fresh.identity == loaded.prepared.identity
            && fresh.connect.url == loaded.prepared.connect.url
            && fresh.connect.certificate == loaded.prepared.connect.certificate,
        "The selected Pi session or voice server changed; reload host settings before saving"
    );
    let snapshot = exchange(&fresh, Some(Value::Object(request.patch)))
        .await
        .context("Host settings save was not confirmed; reload settings before retrying")?;
    normalize(loaded, snapshot)
}

fn editable(provider: Provider) -> &'static [&'static str] {
    if provider == Provider::Grok {
        GROK_KEYS
    } else {
        OPENAI_KEYS
    }
}

async fn exchange(prepared: &Prepared, patch: Option<Value>) -> Result<Value> {
    let mut connection = Connection::open(&prepared.connect).await?;
    let operation = async {
        let path = if prepared.connect.provider == Provider::Grok {
            "/settings"
        } else {
            "/api/settings"
        };
        launch::verify_identity(&prepared.terminal, &prepared.identity).await?;
        if let Some(patch) = patch {
            read_json(&connection, path, Some(patch)).await?;
        }
        // Grok's POST returns only config; GET returns its authoritative catalogs too.
        let snapshot = read_json(&connection, path, None).await?;
        launch::verify_identity(&prepared.terminal, &prepared.identity).await?;
        Ok(snapshot)
    }
    .await;
    let closed = connection.close().await;
    match operation {
        Ok(snapshot) => {
            closed?;
            Ok(snapshot)
        }
        Err(error) => {
            if let Err(close) = closed {
                eprintln!("Cannot close settings connection: {close:#}");
            }
            Err(error)
        }
    }
}

async fn read_json(connection: &Connection, path: &str, patch: Option<Value>) -> Result<Value> {
    let read = async {
        let mut response = connection.request(path, patch).await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.next().await? {
            ensure!(
                bytes.len() + chunk.len() <= 1024 * 1024,
                "Host settings response is too large"
            );
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).context("The selected host returned invalid settings JSON")
    };
    tokio::time::timeout(Duration::from_secs(12), read)
        .await
        .context("Host settings request timed out; reload settings before retrying")?
}

fn normalize(loaded: &Loaded, snapshot: Value) -> Result<Value> {
    let provider = loaded.prepared.connect.provider;
    let source = snapshot["config"].as_object().context(
        "The selected host did not return a settings config; update its voice extension",
    )?;
    let keys = editable(provider);
    ensure!(
        source.get("model").is_some_and(Value::is_string),
        "The selected host did not report a voice model; update its voice extension and reload settings"
    );
    let keys: Vec<_> = keys
        .iter()
        .copied()
        .filter(|key| source.contains_key(*key))
        .collect();
    let mut config: Map<String, Value> = keys
        .iter()
        .map(|key| ((*key).to_owned(), source[*key].clone()))
        .collect();
    if provider != Provider::Grok
        && let Some(model) = source.get("taskDelegationModel")
    {
        config.insert("taskDelegationModel".into(), model.clone());
    }
    let names: &[&str] = if provider == Provider::Grok {
        &["voices", "models", "contextModels", "speeds"]
    } else {
        &[
            "voices",
            "voiceModels",
            "realtimeVoices",
            "contextModels",
            "contextReasoningLevels",
            "webSearchAvailable",
        ]
    };
    let mut catalogs: Map<String, Value> = names
        .iter()
        .filter_map(|key| {
            snapshot
                .get(*key)
                .map(|value| ((*key).to_owned(), value.clone()))
        })
        .collect();
    if provider == Provider::Grok {
        catalogs.insert("reasoningLevels".into(), json!(["none", "high"]));
        catalogs.insert(
            "contextReasoningLevels".into(),
            json!(["off", "minimal", "low", "medium", "high", "xhigh"]),
        );
    }
    Ok(json!({
        "identity": loaded.token,
        "target": loaded.target,
        "terminal": loaded.prepared.terminal,
        "provider": provider,
        "scope": if provider == Provider::Grok { Value::String("Global".into()) } else { snapshot.get("scope").cloned().context("The selected host did not report its settings scope")? },
        "config": config,
        "catalogs": catalogs,
        "editableKeys": keys,
        "runtime": {"available": false, "reason": "The host settings route does not expose the active call configuration"},
        "semantics": {
            "persistence": "Saved on the selected Pi host, not this desktop",
            "runtime": "Saving does not restart a running call. Call setup changes apply on the next call; runtime-read switches may apply sooner.",
            "unsupported": if provider == Provider::Grok { json!(["instructions", "vad"]) } else { json!(["speed", "instructions", "vad"]) },
        },
    }))
}
