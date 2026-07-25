# Code mode source boundary

`vendor/code-mode-src/` tracks OpenAI Codex `rust-v0.145.0` at commit `25af12f7e61572b0bc18ddb1008be543b91519b0`.

Synced upstream source:

- `codex-rs/code-mode-host/src`
- `codex-rs/code-mode-protocol/src`
- `codex-rs/code-mode/src`
- `codex-rs/protocol/src/tool_name.rs`
- upstream `LICENSE` and `NOTICE`

Upstream test modules are omitted. Pi-owned TypeScript, TOML discovery, command execution, package manifests, installer scripts, and minimal Cargo packaging stay outside upstream source trees. Keep conversion-specific activation and nested tool adapters in `src/adapter/`.

The Pi bridge requires the standalone stdio host and never falls back to in-process V8. Unqualified `exec` waits 30 seconds initially; explicit pragmas, custom-tool overrides, and adaptive `wait` backoff remain authoritative. Upstream audio output is neither advertised nor accepted because Pi tool results support text and images.
