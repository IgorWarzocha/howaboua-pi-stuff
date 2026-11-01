use anyhow::{Context, Result, bail};
use http_body_util::{BodyExt, Full};
use hyper::{
    Request, Response,
    body::{Bytes, Incoming},
};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use std::{
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    process::Stdio,
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    process::{Child, Command},
    task::JoinHandle,
};
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, tungstenite::client::IntoClientRequest,
};
use url::Url;

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Grok,
    Gippity,
    Codex,
}

impl Provider {
    pub fn is_openai(self) -> bool {
        matches!(self, Self::Gippity | Self::Codex)
    }

    pub fn accepts(self, actual: Self) -> bool {
        self == actual || (self == Self::Gippity && actual == Self::Codex)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connect {
    pub provider: Provider,
    pub url: String,
    #[serde(default)]
    pub ssh_host: String,
    #[serde(default)]
    pub certificate: String,
    #[serde(default)]
    pub microphone: String,
    #[serde(default)]
    pub speaker: String,
}

impl Connect {
    pub fn validate(&self) -> Result<Url> {
        let url =
            Url::parse(&self.url).context("Enter the HTTPS URL shown by Pi's voice server")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || url.port_or_known_default().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            bail!("Use an HTTPS server URL without credentials, path, query or fragment");
        }
        if !self.ssh_host.is_empty()
            && (self.ssh_host.starts_with('-')
                || !self
                    .ssh_host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-@".contains(&b)))
        {
            bail!(
                "Use an SSH configuration host alias or user@hostname; configure SSH ports and keys in your SSH config"
            );
        }
        if !self.certificate.is_empty() && !PathBuf::from(&self.certificate).is_absolute() {
            bail!("Choose an absolute local path to the server's PEM certificate");
        }
        if self.microphone.contains('\0') || self.speaker.contains('\0') {
            bail!("Invalid audio device selection");
        }
        Ok(url)
    }
}

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct Connection {
    origin: Url,
    tls: native_tls::TlsConnector,
    tunnel: Option<Child>,
    forwarded: Option<SocketAddr>,
}

impl Connection {
    pub async fn open(options: &Connect) -> Result<Self> {
        let origin = options.validate()?;
        let mut tls = native_tls::TlsConnector::builder();
        if !options.certificate.is_empty() {
            let pem = tokio::fs::read(&options.certificate)
                .await
                .context("Cannot read the selected server certificate")?;
            tls.add_root_certificate(
                native_tls::Certificate::from_pem(&pem)
                    .context("The selected file is not a PEM certificate")?,
            );
        }
        let tls = tls.build()?;
        let mut connection = Self {
            origin,
            tls,
            tunnel: None,
            forwarded: None,
        };
        if !options.ssh_host.is_empty() {
            connection.forward(&options.ssh_host).await?;
        }
        Ok(connection)
    }

    fn host(&self) -> Result<&str> {
        self.origin
            .host_str()
            .context("Missing voice server hostname")
    }
    fn authority(&self) -> &str {
        &self.origin[url::Position::BeforeHost..url::Position::AfterPort]
    }

    async fn tcp(&self) -> Result<TcpStream> {
        let stream = match self.forwarded {
            Some(address) => TcpStream::connect(address).await,
            None => TcpStream::connect((self.host()?, self.origin.port_or_known_default().context("Missing voice server port")?)).await,
        }.context("Cannot reach Pi's voice server; start its LAN server and check the address or SSH connection")?;
        stream.set_nodelay(true)?;
        Ok(stream)
    }

    pub async fn request(&self, path: &str, body: Option<serde_json::Value>) -> Result<HttpStream> {
        let request = async {
            let stream = self.tcp().await?;
            let stream = tokio_native_tls::TlsConnector::from(self.tls.clone())
                .connect(self.host()?.trim_matches(['[', ']']), stream)
                .await
                .context("Certificate verification failed; select the server's PEM certificate")?;
            let (mut sender, connection) =
                hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
            let driver = tokio::spawn(connection);
            let mut result = HttpStream {
                response: None,
                driver,
            };
            let method = if body.is_some() { "POST" } else { "GET" };
            let bytes = body
                .map(|value| serde_json::to_vec(&value))
                .transpose()?
                .unwrap_or_default();
            let request = Request::builder()
                .method(method)
                .uri(path)
                .header("host", self.authority())
                .header("content-type", "application/json")
                .body(Full::new(Bytes::from(bytes)))?;
            let response = sender.send_request(request).await?;
            if !response.status().is_success() {
                bail!(
                    "Voice server rejected the request ({}); check its address and active session",
                    response.status()
                );
            }
            result.response = Some(response);
            Ok(result)
        };
        tokio::time::timeout(Duration::from_secs(10), request)
            .await
            .context("Voice server did not respond; check the connection")?
    }

    pub async fn post(&self, path: &str, body: serde_json::Value) -> Result<()> {
        self.post_response(path, body).await.map(|_| ())
    }

    pub async fn stop_browser_call(&self, client: &str) -> Result<()> {
        let bytes = self
            .post_response(
                "/api/stop",
                serde_json::json!({
                    "clientId": client, "terminateConversation": true,
                }),
            )
            .await?;
        let response = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
        match response
            .as_ref()
            .and_then(|value| value["stopped"].as_bool())
        {
            Some(true) => Ok(()),
            Some(false) => bail!(
                "This device no longer owns the selected host call; stop it from Pi if needed"
            ),
            None => bail!(
                "The host did not acknowledge completed Stop; update its voice extension or stop the call from Pi"
            ),
        }
    }

    async fn post_response(&self, path: &str, body: serde_json::Value) -> Result<Vec<u8>> {
        let read = async {
            let mut response = self.request(path, Some(body)).await?;
            let mut result = Vec::new();
            while let Some(bytes) = response.next().await? {
                if result.len() + bytes.len() > 1024 * 1024 {
                    bail!("Voice server response is too large");
                }
                result.extend_from_slice(&bytes);
            }
            Ok(result)
        };
        tokio::time::timeout(Duration::from_secs(10), read)
            .await
            .context("Voice control request timed out")?
    }

    pub async fn websocket(&self, path: &str) -> Result<Socket> {
        let mut url = self.origin.join(path)?;
        url.set_scheme("wss")
            .map_err(|_| anyhow::anyhow!("Cannot configure voice connection"))?;
        let request = url.as_str().into_client_request()?;
        let stream = self.tcp().await?;
        let (socket, _) = tokio_tungstenite::client_async_tls_with_config(request, stream, None, Some(Connector::NativeTls(self.tls.clone())))
            .await.context("Voice connection failed; check the server URL and trust its PEM certificate without disabling verification")?;
        Ok(socket)
    }

    async fn forward(&mut self, host: &str) -> Result<()> {
        let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let address = reservation.local_addr()?;
        drop(reservation);
        let port = self
            .origin
            .port_or_known_default()
            .context("Missing server port")?;
        self.tunnel = Some(
            Command::new("ssh")
                .args([
                    "-N",
                    "-T",
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ExitOnForwardFailure=yes",
                    "-o",
                    "ConnectTimeout=10",
                    "-o",
                    "ServerAliveInterval=15",
                    "-o",
                    "ServerAliveCountMax=3",
                    "-L",
                    &format!("127.0.0.1:{}:127.0.0.1:{port}", address.port()),
                    host,
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .kill_on_drop(true)
                .spawn()
                .context("Cannot start SSH; install OpenSSH and configure a working host alias")?,
        );
        let wait = async {
            loop {
                if let Some(child) = self.tunnel.as_mut()
                    && child.try_wait()?.is_some()
                {
                    bail!(
                        "SSH forwarding failed; verify the host alias, host key and key-based login in your terminal"
                    );
                }
                if TcpStream::connect(address).await.is_ok() {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        };
        tokio::time::timeout(Duration::from_secs(12), wait)
            .await
            .context("SSH forwarding timed out; check your SSH connection")??;
        self.forwarded = Some(address);
        Ok(())
    }

    pub fn check_tunnel(&mut self) -> Result<()> {
        if let Some(child) = self.tunnel.as_mut()
            && child.try_wait()?.is_some()
        {
            bail!("SSH connection ended; reconnect from the voice panel");
        }
        Ok(())
    }

    pub async fn close(&mut self) -> Result<()> {
        if let Some(mut child) = self.tunnel.take() {
            if child.try_wait()?.is_none() {
                child.kill().await?;
            }
            child.wait().await?;
        }
        Ok(())
    }
}

pub struct HttpStream {
    response: Option<Response<Incoming>>,
    driver: JoinHandle<Result<(), hyper::Error>>,
}

impl HttpStream {
    pub async fn next(&mut self) -> Result<Option<Bytes>> {
        let response = self
            .response
            .as_mut()
            .context("Missing voice server response")?;
        loop {
            match response.body_mut().frame().await {
                Some(frame) => {
                    if let Ok(data) = frame?.into_data() {
                        return Ok(Some(data));
                    }
                }
                None => return Ok(None),
            }
        }
    }
}

impl Drop for HttpStream {
    fn drop(&mut self) {
        self.driver.abort();
    }
}
