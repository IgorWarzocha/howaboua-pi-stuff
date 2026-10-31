use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::{Value, json};
use std::process::Stdio;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

// A private Core transport: no inherited sender wrapper and no terminal input.
pub(super) struct Core {
    _child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    sequence: u64,
}

#[derive(Deserialize)]
struct Execution {
    code: Option<i32>,
    timed_out: bool,
    truncated: bool,
    stdout: String,
}

impl Core {
    pub(super) fn open() -> Result<Self> {
        let mut child = Command::new("hc")
            .arg("connect")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .context("Cannot connect to Herdr Core; install hc and start Herdr")?;
        Ok(Self {
            input: child.stdin.take().context("Cannot open Core input")?,
            output: BufReader::new(child.stdout.take().context("Cannot open Core output")?),
            _child: child,
            sequence: 0,
        })
    }

    pub(super) async fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        self.sequence += 1;
        let mut bytes = serde_json::to_vec(
            &json!({"jsonrpc":"2.0", "id":self.sequence, "method":method, "params":params}),
        )?;
        bytes.push(b'\n');
        self.input.write_all(&bytes).await?;
        self.input.flush().await?;
        loop {
            let mut line = String::new();
            if self.output.read_line(&mut line).await? == 0 {
                bail!("Herdr Core disconnected");
            }
            let message: Value =
                serde_json::from_str(&line).context("Invalid response from Herdr Core")?;
            if message["id"].as_u64() != Some(self.sequence) {
                continue;
            }
            if let Some(error) = message.get("error") {
                bail!("Herdr Core request failed: {error}");
            }
            return message
                .get("result")
                .cloned()
                .context("Missing Herdr Core response");
        }
    }

    pub(super) async fn node(
        &mut self,
        on: &Option<String>,
        script: &str,
        args: Vec<String>,
    ) -> Result<Value> {
        let script = format!(
            "try {{\n{script}\n}} catch (error) {{ console.log(JSON.stringify({{herdrVoiceError:error.message}})); process.exitCode=1; }}"
        );
        let mut argv = vec!["node".to_owned(), "-e".to_owned(), script];
        argv.extend(args);
        let result: Execution = serde_json::from_value(
            self.call("machine.exec", json!({"on":on,"argv":argv,"timeout":10}))
                .await?,
        )
        .context("Invalid Core execution response")?;
        let decoded = decode_base64(&result.stdout)?;
        if result.code != Some(0) || result.timed_out || result.truncated {
            if let Ok(value) = serde_json::from_slice::<Value>(&decoded)
                && let Some(error) = value["herdrVoiceError"].as_str()
            {
                bail!("Cannot prepare Pi: {error}");
            }
            bail!(
                "Cannot prepare Pi on the selected machine; install Node.js and Pi and check Core access"
            );
        }
        serde_json::from_slice(&decoded).context("Invalid Pi preparation response")
    }

    pub(super) async fn read(&mut self, on: &Option<String>, path: &str) -> Result<String> {
        let result = self.call("file.read", json!({"on":on,"path":path})).await?;
        Ok(result["text"]
            .as_str()
            .context("Missing file contents")?
            .to_owned())
    }
}

fn decode_base64(input: &str) -> Result<Vec<u8>> {
    let mut result = Vec::new();
    let mut bits = 0u32;
    let mut count = 0;
    for byte in input.bytes().take_while(|byte| *byte != b'=') {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => bail!("Invalid machine output encoding"),
        };
        bits = (bits << 6) | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            result.push((bits >> count) as u8);
        }
    }
    Ok(result)
}
