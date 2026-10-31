use crate::connection::{Connection, HttpStream, Provider, Socket};
use anyhow::{Context, Result, bail};
use futures_util::SinkExt;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

pub struct Transport {
    pub socket: Socket,
    pub events: Events,
}

pub struct Events {
    stream: Option<HttpStream>,
    buffered: Vec<u8>,
}

impl Transport {
    pub async fn open(
        connection: &Connection,
        provider: Provider,
        client: &str,
        token: Option<&str>,
    ) -> Result<Self> {
        // Registration must precede audio: the server checks the client identity.
        let events = if provider.is_openai() {
            Some(
                connection
                    .request(&format!("/api/events?client={client}"), None)
                    .await?,
            )
        } else {
            None
        };
        let mut events = Events {
            stream: events,
            buffered: Vec::new(),
        };
        if let Some(token) = token {
            loop {
                let event = events.next().await?;
                if event["type"] == "ready" && event["takeoverToken"] == token {
                    break;
                }
            }
        }
        let path = match provider {
            Provider::Grok => "/audio".into(),
            Provider::Gippity | Provider::Codex => format!("/api/audio?client={client}"),
        };
        let mut transport = Self {
            socket: connection.websocket(&path).await?,
            events,
        };
        if provider.is_openai() {
            let mut start = json!({"type":"start","mode":"conversation"});
            if let Some(token) = token {
                start["takeoverToken"] = token.into();
            }
            transport.send(start).await?;
        }
        Ok(transport)
    }

    pub async fn send(&mut self, value: Value) -> Result<()> {
        self.socket
            .send(Message::Text(value.to_string().into()))
            .await?;
        Ok(())
    }

    pub async fn replacement(
        connection: &Connection,
        provider: Provider,
        client: &str,
        token: &str,
    ) -> Result<Self> {
        let replace = async {
            loop {
                match Self::open(connection, provider, client, Some(token)).await {
                    Ok(transport) => return Ok(transport),
                    Err(_) => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
                }
            }
        };
        tokio::time::timeout(std::time::Duration::from_secs(20), replace)
            .await
            .context("Transferred Pi session did not become ready; select its pane and reconnect")?
    }

    pub async fn close(&mut self) {
        // Disconnect releases this device, not the host-owned provider call.
        let _ =
            tokio::time::timeout(std::time::Duration::from_secs(1), self.socket.close(None)).await;
    }
}

impl Events {
    pub async fn next(&mut self) -> Result<Value> {
        let Some(events) = self.stream.as_mut() else {
            return std::future::pending().await;
        };
        loop {
            if let Some(end) = self.buffered.iter().position(|b| *b == b'\n') {
                let line: Vec<_> = self.buffered.drain(..=end).collect();
                let line = std::str::from_utf8(&line)?.trim_end_matches(['\r', '\n']);
                if let Some(data) = line.strip_prefix("data:") {
                    return serde_json::from_str(data.trim()).context("Invalid voice server event");
                }
                continue;
            }
            let bytes = events
                .next()
                .await?
                .context("Voice server updates ended; reconnect from the panel")?;
            if self.buffered.len() + bytes.len() > 1024 * 1024 {
                bail!("Voice server event is too large");
            }
            self.buffered.extend_from_slice(&bytes);
        }
    }
}
