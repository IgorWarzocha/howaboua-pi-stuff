# Codex code-mode sync

`vendor/code-mode-src/UPSTREAM` pins the OpenAI Codex commit used by the standalone host. The package currently follows the `rust-v0.144.1` host protocol and downloads the matching checksummed release asset for the current platform when a dynamic tool is first configured.

The vendored runtime source consists of:

- `codex-rs/code-mode/src`
- `codex-rs/code-mode-host/src`
- `codex-rs/code-mode-protocol/src`
- `codex-rs/protocol/src/tool_name.rs`
- `LICENSE` and `NOTICE`

Tests are omitted because they depend on Codex-wide fixtures. Cargo manifests and the minimal `codex-protocol` crate are Pi-owned packaging boundaries.

Sync from a local Codex checkout, review the diff, update the release asset version and checksums in `scripts/host-assets.mjs`, then rebuild:

```bash
CODEX_SOURCE_DIR=/path/to/codex bun run sync:codex
bun run build:host
```

CI verifies every pinned upstream platform asset when the asset metadata changes. Published installs lazily download the matching verified asset; they do not compile Rust on the user's machine. Build the vendored source manually only while updating the upstream pin.
