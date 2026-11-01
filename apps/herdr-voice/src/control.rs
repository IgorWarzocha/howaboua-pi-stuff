use crate::{
    audio,
    config::Config,
    connection::Connect,
    session::{self, Command, Phase, SharedStatus, Status},
};
use anyhow::{Context, Result, bail};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    net::Ipv4Addr,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{Mutex, RwLock, mpsc, oneshot, watch},
    task::JoinHandle,
};

struct Running {
    cancel: watch::Sender<Option<bool>>,
    commands: mpsc::Sender<Command>,
    task: JoinHandle<Result<()>>,
}

struct Companion {
    config: Config,
    status: SharedStatus,
    running: Mutex<Option<Running>>,
    preparing: Mutex<()>,
    stopping: AtomicBool,
    shutdown: watch::Sender<bool>,
}

impl Companion {
    async fn connect(&self, options: Connect) -> Result<Status> {
        options.validate()?;
        let mut running = self.running.lock().await;
        if self.stopping.load(Ordering::Acquire) {
            bail!("Voice companion is shutting down");
        }
        if let Some(previous) = running.as_ref()
            && !previous.task.is_finished()
        {
            bail!(
                "Voice is already connected or connecting; disconnect it before choosing another session"
            );
        }
        if let Some(previous) = running.take() {
            let _ = previous
                .task
                .await
                .context("Voice task stopped unexpectedly")?;
        }
        *self.status.write().await = Status {
            phase: Phase::Connecting,
            provider: Some(options.provider),
            url: Some(options.url.clone()),
            muted: false,
            error: None,
        };
        let (cancel, cancelled) = watch::channel(None);
        let (commands, receiver) = mpsc::channel(8);
        let task = tokio::spawn(session::run(
            options,
            self.status.clone(),
            cancelled,
            receiver,
        ));
        *running = Some(Running {
            cancel,
            commands,
            task,
        });
        Ok(self.status.read().await.clone())
    }

    async fn disconnect(&self, end_call: bool) -> Result<Status> {
        let mut running = self.running.lock().await;
        if let Some(active) = running.take() {
            let _ = active.cancel.send(Some(end_call));
            active
                .task
                .await
                .context("Voice task stopped unexpectedly")??;
        }
        *self.status.write().await = Status::default();
        Ok(self.status.read().await.clone())
    }

    async fn mute(&self, muted: bool) -> Result<Status> {
        let commands = {
            let running = self.running.lock().await;
            running
                .as_ref()
                .context("No voice device is connected")?
                .commands
                .clone()
        };
        if !matches!(
            self.status.read().await.phase,
            Phase::Listening | Phase::Muted
        ) {
            bail!("Wait for voice to connect before changing mute");
        }
        let (reply, response) = oneshot::channel();
        commands
            .send(Command::Mute(muted, reply))
            .await
            .context("Voice connection ended; reconnect from the panel")?;
        tokio::time::timeout(Duration::from_secs(12), response)
            .await
            .context("Microphone mute timed out; disconnect and reconnect")?
            .context("Voice connection ended before mute was confirmed")?
            .map_err(anyhow::Error::msg)?;
        Ok(self.status.read().await.clone())
    }
}

type ApiResult<T> = std::result::Result<Json<T>, ApiError>;
struct ApiError(anyhow::Error);
impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self(error)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let terminal = self
            .0
            .downcast_ref::<crate::launch::StartedTerminal>()
            .map(|started| started.terminal.as_str());
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":format!("{:#}", self.0),"terminal":terminal})),
        )
            .into_response()
    }
}

pub async fn serve(config: Config) -> Result<()> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, config.port))
        .await
        .context("Cannot start the voice companion; another process may already use its port")?;
    let (shutdown_signal, _) = watch::channel(false);
    let state = Arc::new(Companion {
        config,
        status: Arc::new(RwLock::new(Status::default())),
        running: Mutex::new(None),
        preparing: Mutex::new(()),
        stopping: AtomicBool::new(false),
        shutdown: shutdown_signal,
    });
    let router = Router::new()
        .route("/status", get(status))
        .route("/devices", get(devices))
        .route("/connect", post(connect))
        .route("/prepare", post(prepare))
        .route("/disconnect", post(disconnect))
        .route("/mute", post(mute))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        .with_state(state.clone());
    eprintln!(
        "Voice companion listening at http://127.0.0.1:{}; microphone closed until Connect",
        state.config.port
    );
    let shutdown = state.clone();
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            wait_for_shutdown().await;
            shutdown.stopping.store(true, Ordering::Release);
            let _ = shutdown.shutdown.send(true);
            if let Err(error) = shutdown.disconnect(false).await {
                eprintln!("Cannot finish voice shutdown: {error:#}");
            }
        })
        .await?;
    Ok(())
}

async fn authorize(State(state): State<Arc<Companion>>, request: Request, next: Next) -> Response {
    let expected_host = format!("127.0.0.1:{}", state.config.port);
    if request.headers().contains_key(header::ORIGIN)
        || request
            .headers()
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            != Some(expected_host.as_str())
        || request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            != Some(format!("Bearer {}", state.config.token).as_str())
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Voice authorization failed; run the companion installer again"})),
        )
            .into_response();
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

async fn status(State(state): State<Arc<Companion>>) -> Json<Status> {
    Json(state.status.read().await.clone())
}
async fn devices() -> ApiResult<Value> {
    Ok(Json(audio::devices().await?))
}
async fn connect(
    State(state): State<Arc<Companion>>,
    Json(options): Json<Connect>,
) -> ApiResult<Status> {
    Ok(Json(state.connect(options).await?))
}
async fn disconnect(State(state): State<Arc<Companion>>) -> ApiResult<Status> {
    Ok(Json(state.disconnect(true).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Mute {
    muted: bool,
}
async fn mute(State(state): State<Arc<Companion>>, Json(options): Json<Mute>) -> ApiResult<Status> {
    Ok(Json(state.mute(options.muted).await?))
}

async fn prepare(
    State(state): State<Arc<Companion>>,
    Json(options): Json<crate::launch::Prepare>,
) -> ApiResult<crate::launch::Prepared> {
    let mut shutdown = state.shutdown.subscribe();
    let _preparing = state.preparing.lock().await;
    if state.stopping.load(Ordering::Acquire) {
        return Err(anyhow::anyhow!("Voice companion is shutting down").into());
    }
    if state
        .running
        .lock()
        .await
        .as_ref()
        .is_some_and(|running| !running.task.is_finished())
    {
        return Err(anyhow::anyhow!(
            "Disconnect the current voice device before starting another session"
        )
        .into());
    }
    tokio::select! {
        _ = shutdown.changed() => Err(anyhow::anyhow!("Voice startup cancelled because the companion is shutting down").into()),
        result = crate::launch::prepare(options) => Ok(Json(result?)),
    }
}

async fn wait_for_shutdown() {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! { _ = tokio::signal::ctrl_c() => (), _ = terminate.recv() => () }
                return;
            }
            Err(error) => eprintln!("Cannot watch termination signal: {error}"),
        }
    }
    if let Err(error) = tokio::signal::ctrl_c().await {
        eprintln!("Cannot watch shutdown signal: {error}");
    }
}
