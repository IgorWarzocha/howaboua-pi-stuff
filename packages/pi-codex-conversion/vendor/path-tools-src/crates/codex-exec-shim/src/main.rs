use std::collections::HashMap;
use std::io::BufRead;
use std::path::PathBuf;

use codex_exec_shim::local_process::LocalProcess;
use codex_exec_shim::protocol::*;
use codex_exec_shim::ProcessId;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    Exec { request_id: u64, process_id: String, argv: Vec<String>, cwd: String, env: HashMap<String, String>, tty: bool, pipe_stdin: bool, arg0: Option<String> },
    Read { request_id: u64, process_id: String, after_seq: Option<u64>, max_bytes: Option<usize>, wait_ms: Option<u64> },
    Write { request_id: u64, process_id: String, chunk: Vec<u8> },
    Terminate { request_id: u64, process_id: String },
    Shutdown { request_id: u64 },
}

#[derive(Debug, Serialize)]
struct Response {
    request_id: u64,
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

fn print_response<T: Serialize>(request_id: u64, result: Result<T, String>) {
    let response = match result {
        Ok(result) => Response { request_id, ok: true, result: Some(serde_json::to_value(result).unwrap()), error: None },
        Err(error) => Response { request_id, ok: false, result: None, error: Some(error) },
    };
    println!("{}", serde_json::to_string(&response).unwrap());
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let backend = LocalProcess::default();
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                print_response(0, Err::<serde_json::Value, _>(format!("invalid request: {error}")));
                continue;
            }
        };
        match request {
            Request::Exec { request_id, process_id, argv, cwd, env, tty, pipe_stdin, arg0 } => {
                let result = backend.exec(ExecParams { process_id: ProcessId::from(process_id), argv, cwd: PathBuf::from(cwd), env, tty, pipe_stdin, arg0 }).await.map_err(|e| e.to_string());
                print_response(request_id, result);
            }
            Request::Read { request_id, process_id, after_seq, max_bytes, wait_ms } => {
                let result = backend.exec_read(ReadParams { process_id: ProcessId::from(process_id), after_seq, max_bytes, wait_ms }).await.map_err(|e| e.to_string());
                print_response(request_id, result);
            }
            Request::Write { request_id, process_id, chunk } => {
                let result = backend.exec_write(WriteParams { process_id: ProcessId::from(process_id), chunk: chunk.into() }).await.map_err(|e| e.to_string());
                print_response(request_id, result);
            }
            Request::Terminate { request_id, process_id } => {
                let result = backend.terminate_process(TerminateParams { process_id: ProcessId::from(process_id) }).await.map_err(|e| e.to_string());
                print_response(request_id, result);
            }
            Request::Shutdown { request_id } => {
                backend.shutdown().await;
                print_response(request_id, Ok(json!({ "shutdown": true })));
                break;
            }
        }
    }
    backend.shutdown().await;
    Ok(())
}
