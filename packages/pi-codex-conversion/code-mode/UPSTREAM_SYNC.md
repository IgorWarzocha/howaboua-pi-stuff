# Code mode runtime

Code mode downloads OpenAI's official `rust-v0.163.0` standalone host. `src/tools/code-mode/host-assets.ts` owns the release and platform asset SHA256 pins. The installer verifies the download and caches it by release and platform. There is no vendored runtime source, local build or bundled-host fallback. `tools.customRustBinariesDir` applies to the other native helpers, not this host.

The upstream implementation lives in OpenAI Codex's `codex-rs/code-mode-host/`, `codex-rs/code-mode-runtime/` and `codex-rs/code-mode-protocol/`. Compare those directories when changing the Pi bridge or updating the host pin. Verify every pinned asset with `bun run verify:code-mode-host-assets`, then exercise the bridge against the downloaded executable. Preserve the upstream `LICENSE` and `NOTICE` beside this file.

Pi owns the TypeScript bridge, tool discovery, command execution and activation adapters. The bridge uses the standalone stdio protocol directly and never falls back to in-process V8. Unqualified `exec` waits 30 seconds initially. Explicit pragmas, custom-tool overrides and adaptive `wait` backoff remain authoritative. Upstream audio output is neither advertised nor accepted because Pi tool results support text and images.
