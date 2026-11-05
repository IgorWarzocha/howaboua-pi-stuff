use crate::{connection::Provider, machine_core::Core};
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
    machine: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Save {
    provider: Provider,
    machine: Option<String>,
    identity: String,
    patch: Map<String, Value>,
}

// One loaded editor per companion; the client cannot supply a config or executable path.
pub struct Loaded {
    token: String,
    target: Target,
    backend_identity: Value,
    package_root: String,
}

pub async fn load(target: Target) -> Result<(Loaded, Value)> {
    let snapshot = exchange(&target, None, None).await?;
    let loaded = Loaded {
        token: uuid::Uuid::new_v4().to_string(),
        target,
        backend_identity: snapshot["identity"]
            .as_object()
            .context("The host did not identify its settings store")?
            .clone()
            .into(),
        package_root: snapshot["packageRoot"]
            .as_str()
            .context("The host did not identify its voice extension")?
            .to_owned(),
    };
    let response = normalize(&loaded, snapshot)?;
    Ok((loaded, response))
}

pub async fn save(loaded: &Loaded, request: Save) -> Result<Value> {
    let target = Target {
        provider: request.provider,
        machine: request.machine,
    };
    ensure!(
        request.identity == loaded.token && target == loaded.target,
        "Host settings target changed or expired; reload settings before saving"
    );
    ensure!(!request.patch.is_empty(), "No host settings were changed");
    let keys = editable(target.provider);
    ensure!(
        request.patch.keys().all(|key| keys.contains(&key.as_str())),
        "This patch contains unsupported host settings; reload settings and use the available controls"
    );
    let snapshot = exchange(&target, Some(loaded), Some(Value::Object(request.patch)))
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

async fn exchange(target: &Target, loaded: Option<&Loaded>, patch: Option<Value>) -> Result<Value> {
    let operation = async {
        let mut core = Core::open()?;
        core.node(
            &target.machine,
            include_str!("../machine-settings.cjs"),
            vec![
                serde_json::to_string(&json!({
                    "provider": target.provider,
                    "patch": patch,
                    "identity": loaded.map(|state| &state.backend_identity),
                    "packageRoot": loaded.map(|state| &state.package_root),
                }))?,
                include_str!("../machine-settings.ts").to_owned(),
            ],
        )
        .await
    };
    tokio::time::timeout(Duration::from_secs(15), operation)
        .await
        .context("Host settings request timed out; reload settings before retrying")?
}

fn normalize(loaded: &Loaded, snapshot: Value) -> Result<Value> {
    let provider = loaded.target.provider;
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
        "provider": provider,
        "scope": snapshot.get("scope").cloned().context("The selected host did not report its settings scope")?,
        "config": config,
        "catalogs": catalogs,
        "editableKeys": keys,
        "runtime": {"available": false, "reason": "Global settings are independent of running Pi sessions"},
        "semantics": {
            "persistence": "Saved globally on the selected host; project overrides remain unchanged",
            "runtime": "Saving does not restart a running call. Start a new call to use the saved settings. Project overrides still take precedence.",
            "unsupported": if provider == Provider::Grok { json!(["instructions", "vad"]) } else { json!(["speed", "instructions", "vad"]) },
        },
    }))
}
