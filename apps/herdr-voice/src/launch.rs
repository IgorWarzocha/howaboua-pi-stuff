use crate::{
    config,
    connection::{Connect, Provider},
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{BTreeMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    time::Duration,
};
#[path = "launch_core.rs"]
mod core;
use core::Core;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prepare {
    pub provider: Provider,
    pub terminal: Option<String>,
    pub machine: Option<String>,
    #[serde(default)]
    pub ssh_host: String,
}

#[derive(Serialize)]
pub struct Prepared {
    pub terminal: String,
    pub connect: Connect,
    #[serde(skip)]
    pub(crate) identity: PaneIdentity,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct PaneIdentity {
    address: String,
    agent_dir: String,
    session: String,
    provider: Provider,
}

#[derive(Deserialize)]
struct Pane {
    address: String,
    labels: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    request_id: String,
    session_id: String,
    terminal_id: Option<String>,
    provider: Provider,
    running: bool,
    urls: Vec<String>,
    error: Option<String>,
}

pub async fn prepare(request: Prepare) -> Result<Prepared> {
    let mut created = None;
    let result = tokio::time::timeout(Duration::from_secs(60), prepare_inner(request, &mut created)).await
        .context("Pi voice startup timed out. Inspect the selected Pi pane; it may still be starting. Install the bridge and run /reload in existing panes")
        .and_then(|result| result);
    match created {
        Some(terminal) => result.context(StartedTerminal { terminal }),
        None => result,
    }
}

#[derive(Debug)]
pub struct StartedTerminal {
    pub terminal: String,
}
impl std::fmt::Display for StartedTerminal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "Pi started in {}; inspect its pane",
            self.terminal
        )
    }
}
impl std::error::Error for StartedTerminal {}

async fn prepare_inner(request: Prepare, created: &mut Option<String>) -> Result<Prepared> {
    let mut core = Core::open()?;
    let id = uuid::Uuid::new_v4().to_string();
    let provider = match request.provider {
        Provider::Grok => "grok",
        Provider::Gippity => "gippity",
        Provider::Codex => "codex",
    };
    let quickstart = request.terminal.is_none();
    let terminal = match request.terminal {
        Some(terminal) if !terminal.is_empty() => terminal,
        Some(_) => bail!("Select a Pi pane"),
        None => {
            // Resolve the actual executable, not Core's possibly named `pi` template.
            let setup = core
                .node(
                    &request.machine,
                    PROVISION,
                    vec![include_str!("../pi-bridge.ts").to_owned()],
                )
                .await?;
            let executable = setup["pi"]
                .as_str()
                .context("Pi is not installed on the selected machine")?;
            let home = setup["home"]
                .as_str()
                .context("Cannot locate the selected user's home")?;
            let result = core.call("terminal.run", json!({
                "on":request.machine,"cwd":home,"argv":[executable,format!("/herdr-voice-start {provider} {id}")],
                "caller":null,"no_parent":true,"no_notify":true,"outlive_parent":true,
            })).await?;
            result["address"]
                .as_str()
                .context("Core did not return the new Pi pane")?
                .to_owned()
        }
    };
    if quickstart {
        *created = Some(terminal.clone());
    }
    let on = terminal
        .split_once('/')
        .map(|(machine, _)| machine.to_owned());
    let local_terminal = terminal
        .rsplit('/')
        .next()
        .context("Invalid Pi pane")?
        .to_owned();
    let pane = loop {
        let pane: Pane = serde_json::from_value(
            core.call("terminal.get", json!({"terminal":terminal,"caller":null}))
                .await?,
        )?;
        if pane.labels.get("herdr.voice").map(String::as_str) == Some("1") {
            break pane;
        }
        if !quickstart {
            bail!(
                "This Pi pane has no voice bridge. Quickstart a new Pi pane, or install the bundled pi-bridge.ts in your Pi extensions directory and run /reload"
            );
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    };
    let agent_dir = pane
        .labels
        .get("herdr.voice.agent-dir")
        .context("Pi bridge did not publish its agent directory; run /reload")?;
    let session = pane
        .labels
        .get("herdr.voice.session")
        .context("Pi bridge did not publish its session; run /reload")?;
    if !quickstart {
        core.node(
            &on,
            REQUEST,
            vec![
                agent_dir.clone(),
                id.clone(),
                session.clone(),
                local_terminal.clone(),
                provider.to_owned(),
            ],
        )
        .await?;
    }
    let path = format!("{agent_dir}/runtime/voice-requests/{id}.json");
    let result = read_receipt(
        &mut core,
        &on,
        &path,
        &id,
        session,
        &local_terminal,
        request.provider,
    )
    .await;
    // The bridge also expires receipts if this future is cancelled or Core disconnects.
    let cleanup = core.node(&on, CLEANUP, vec![agent_dir.clone(), id]).await;
    let receipt = result?;
    cleanup.context("Voice started, but its startup receipt could not be removed")?;
    let current: Pane = serde_json::from_value(
        core.call("terminal.get", json!({"terminal":terminal,"caller":null}))
            .await?,
    )?;
    if current.address != pane.address
        || [
            "herdr.voice",
            "herdr.voice.agent-dir",
            "herdr.voice.session",
        ]
        .iter()
        .any(|key| current.labels.get(*key) != pane.labels.get(*key))
    {
        bail!("The Pi pane changed during voice startup; select it again");
    }
    let certificate_dir = match request.provider {
        Provider::Grok => "grok-lan",
        Provider::Gippity | Provider::Codex => "lan-voice",
    };
    let pem = core
        .read(
            &on,
            &format!("{agent_dir}/{certificate_dir}/certificate.pem"),
        )
        .await?;
    native_tls::Certificate::from_pem(pem.as_bytes())
        .context("Pi returned an invalid server certificate")?;
    let cache = config::directory()?.join("certificates");
    tokio::fs::create_dir_all(&cache).await?;
    let mut fingerprint = DefaultHasher::new();
    pem.hash(&mut fingerprint);
    let certificate = cache.join(format!("{:016x}.pem", fingerprint.finish()));
    if certificate.exists() {
        if tokio::fs::read(&certificate).await? != pem.as_bytes() {
            bail!("Cached Pi certificate differs; remove the cached certificate and retry");
        }
    } else {
        config::private_write(&certificate, pem.as_bytes(), true)?;
    }
    let url = select_url(&receipt.urls, on.is_none() || !request.ssh_host.is_empty()).await?;
    let connect = Connect {
        provider: receipt.provider,
        url,
        ssh_host: request.ssh_host,
        certificate: certificate.to_string_lossy().into_owned(),
        microphone: String::new(),
        speaker: String::new(),
    };
    connect.validate()?;
    let identity = PaneIdentity {
        address: pane.address,
        agent_dir: agent_dir.clone(),
        session: session.clone(),
        provider: receipt.provider,
    };
    Ok(Prepared {
        terminal,
        connect,
        identity,
    })
}

pub(crate) async fn verify_identity(terminal: &str, identity: &PaneIdentity) -> Result<()> {
    let check = async {
        let mut core = Core::open()?;
        let pane: Pane = serde_json::from_value(
            core.call("terminal.get", json!({"terminal":terminal,"caller":null}))
                .await?,
        )?;
        if pane.address != identity.address
            || pane.labels.get("herdr.voice").map(String::as_str) != Some("1")
            || pane.labels.get("herdr.voice.agent-dir") != Some(&identity.agent_dir)
            || pane.labels.get("herdr.voice.session") != Some(&identity.session)
        {
            bail!("The selected Pi session changed; reload host settings before saving");
        }
        Ok(())
    };
    tokio::time::timeout(Duration::from_secs(10), check)
        .await
        .context("Cannot verify the selected Pi session; reload host settings")?
}

async fn read_receipt(
    core: &mut Core,
    on: &Option<String>,
    path: &str,
    id: &str,
    session: &str,
    terminal: &str,
    provider: Provider,
) -> Result<Receipt> {
    loop {
        if let Ok(text) = core.read(on, path).await {
            let receipt: Receipt =
                serde_json::from_str(&text).context("Invalid Pi voice startup receipt")?;
            if receipt.request_id != id
                || receipt.session_id != session
                || receipt.terminal_id.as_deref() != Some(terminal)
                || !provider.accepts(receipt.provider)
            {
                bail!(
                    "Pi voice startup returned a different session or pane; select the intended Pi pane again"
                );
            }
            if let Some(error) = &receipt.error {
                bail!("Pi could not start voice: {error}");
            }
            if !receipt.running {
                bail!("Pi's voice listener is stopped; inspect the selected Pi pane");
            }
            return Ok(receipt);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn select_url(urls: &[String], local: bool) -> Result<String> {
    let candidates: Vec<_> = urls
        .iter()
        .filter_map(|value| url::Url::parse(value).ok())
        .filter(|url| url.scheme() == "https")
        .collect();
    if local {
        // Both bundled backends listen on IPv4 wildcard and certify localhost,
        // but their public URL lists deliberately omit loopback addresses.
        let mut url = candidates
            .first()
            .cloned()
            .context("Pi did not return a voice URL")?;
        url.set_host(Some("localhost"))?;
        return Ok(url.to_string());
    }
    for url in candidates {
        let Some(host) = url.host_str() else {
            continue;
        };
        if matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
            continue;
        }
        let Some(port) = url.port_or_known_default() else {
            continue;
        };
        if matches!(
            tokio::time::timeout(
                Duration::from_secs(2),
                tokio::net::TcpStream::connect((host.trim_matches(['[', ']']), port))
            )
            .await,
            Ok(Ok(_))
        ) {
            return Ok(url.to_string());
        }
    }
    bail!(
        "Pi did not return a reachable voice URL; configure an SSH host for remote loopback access"
    )
}

const PROVISION: &str = r#"
const fs=require('fs'),os=require('os'),p=require('path');
const pi=(process.env.PATH||'').split(p.delimiter).map(d=>p.resolve(d,process.platform==='win32'?'pi.cmd':'pi')).find(f=>{try{fs.accessSync(f,fs.constants.X_OK);return fs.statSync(f).isFile()}catch{return false}});
if(!pi)throw Error('Install Pi on this machine');
const agent=process.env.PI_CODING_AGENT_DIR||p.join(os.homedir(),'.pi','agent');
const dir=p.join(agent,'extensions');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const file=p.join(dir,'herdr-voice-bridge.ts'),tmp=file+'.'+process.pid+'.tmp';
if(fs.existsSync(file)&&!fs.readFileSync(file,'utf8').startsWith('// herdr-voice-managed-bridge v1\n'))throw Error('An unrelated extension occupies '+file+'; move it before retrying');
fs.writeFileSync(tmp,process.argv[1],{mode:0o600});fs.renameSync(tmp,file);
console.log(JSON.stringify({pi,home:os.homedir()}));
"#;

const REQUEST: &str = r#"
const fs=require('fs'),p=require('path');const [agent,id,sessionId,terminalId,provider]=process.argv.slice(1);
const dir=p.join(agent,'runtime','herdr-voice-requests');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const file=p.join(dir,id+'.json'),tmp=file+'.tmp';
fs.writeFileSync(tmp,JSON.stringify({sessionId,terminalId,provider,expiresAt:Date.now()+60000}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);
console.log('{}');
"#;

const CLEANUP: &str = r#"
const fs=require('fs'),p=require('path');const [agent,id]=process.argv.slice(1);
for(const dir of ['voice-requests','herdr-voice-requests'])fs.rmSync(p.join(agent,'runtime',dir,id+'.json'),{force:true});console.log('{}');
"#;
