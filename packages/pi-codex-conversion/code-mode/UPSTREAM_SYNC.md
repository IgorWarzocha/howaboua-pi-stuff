# Code mode source boundary

`vendor/code-mode-src/` tracks OpenAI Codex `rust-v0.144.1` at commit `44918ea10c0f99151c6710411b4322c2f5c96bea`.

Synced upstream source:

- `codex-rs/code-mode-host/src`
- `codex-rs/code-mode-protocol/src`
- `codex-rs/code-mode/src`
- `codex-rs/protocol/src/tool_name.rs`
- upstream `LICENSE` and `NOTICE`

Pi-owned TypeScript, TOML discovery, command execution, package manifests, installer scripts, and minimal Cargo packaging stay outside upstream source trees. Keep conversion-specific activation and nested tool adapters in `src/adapter/`.
