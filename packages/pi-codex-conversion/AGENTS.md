- Model-native Codex prompts/tools/transport/context in Pi. Features: model fit, quota efficiency or Pi integration only. Native semantics, cache, continuation intact; document adaptations. Cache noise alone never justifies drift. Review-driven drift from stock Pi needs backend proof or intent. GPT harness only; no universal compatibility, enterprise, UI or Pi fork. Uncommon needs: overrides/extensions/forks.
- Keep healthy initial WebSocket attempt. Retryable connection failure → ≤3 fresh WS retries/5 min → request-local SSE/separate 5 min. 426, advertised send-limit rejection or pre-text 1009 → immediate session-wide SSE. No size-close replay after output.
- `server_is_overloaded` and `slow_down`: one three-minute WS/SSE budget. Honour HTTP/streamed advice on monotonic deadlines. Beyond budget → fail, even across fallback.
- Before npm/publish/release/merge, compare `src/providers/openai-codex-custom-provider.ts` to Pi stock `openai-codex-responses`: request, transport, headers, reasoning, tier, retries, termination, touched behaviour.
- Identity by backend, not name/endpoint. Renamed/proxied `openai-codex-responses` keeps Codex transport, Fast Mode, account isolation. Proxies: policy/monitoring/routing. Env proxies keep ChatGPT contracts; explicit `openai-responses` passthrough limited to backend capabilities.
- Native compaction only for OpenAI Codex or configured OpenAI/Codex passthrough. V2 requires raw Responses output items, not arbitrary streams. Agent Comms owns Notes/history/window.
- Nested adapters preserve declared `structuredContent` after protected-output checks. Protected results: opaque receipts, never JS data.
- Prompt: short, argv-shaped. README: foldable, user-facing, no duplicate APIs/developer setup. Contracts: `../../docs/extension-apis.md`.
- Run bundled helpers directly. Rebuild checkout, don't patch npm install. Web/image: TS packages. `tools.customRustBinariesDir`: filename-based helper override, not Code host. Incompatibility errors point there, no loader noise.
- `src/voice/rust/**` and `scripts/build-voice-helper.mjs`: byte-identical with `pi-gippity-control`; change and changeset together.
- Native builds: `github_watch` if help supports Actions URLs, else `gh run watch <id> --exit-status` near 10–15 min. No polling loops, background shells or temp logs.
- Instructions → `src/developer-messages.ts`. `trySendCodexDeveloperCustomMessage` preserves rendering; false = unsent → `pi.sendMessage`. Delivery errors throw.
- `src/adapter/developer-messages.ts`: authenticated carriers → in-place Responses developer items. Preserve chronology and UI/history identity independent of provider role. No system-prompt updates.
- TS topology changes → root `bun run knip`.

## Upstream routes

Before upstream-derived edits: pin vs `~/Frameworks/codex` HEAD + path history. Reference only, no automatic upgrade. Keep Pi adaptations; provenance for adopted code only. Paths relative to `~/Frameworks/codex/codex-rs/`:

- Code host: `code-mode-host/src/`, `code-mode-runtime/src/`, `code-mode-protocol/src/`. Official executable pinned in `src/tools/code-mode/host-assets.ts`; no vendored source/local build.
- `apply-patch/src/`, `utils/absolute-path/src/`, `utils/path-uri/src/`: one pin, `src/tools/rust/UPSTREAM.apply-patch`. Product changes in sync-preserved `standalone_executable.rs` and `pi-apply-patch-fs`. Keep API adaptations in `src/tools/rust/VENDORED.md`.
- `utils/image/src/` and `utils/cache/src/`: shared pin `src/tools/rust/crates/codex-utils-image/UPSTREAM`. `src/tools/view-image/rust/main.rs`: Pi wrapper.
- `utils/pty/src/`: `src/tools/rust/crates/codex-utils-pty/UPSTREAM`. Shell adapts `exec-server/src/local_process.rs`, pin `src/tools/exec/rust/UPSTREAM`; not a copied server.
- `voice-host/src/device_buffers.rs` and `voice-host/src/processing.rs` → `src/voice/rust/src/codex_audio/{buffers,processing}.rs`. Pin/adaptations: `src/voice/rust/VENDORED.md`. Its `vendor/`: licences only.
- Sonora 0.2.0 pinned. [0.3 changes calling thread floating-point mode during DSP](https://github.com/dignifiedquire/sonora/releases/tag/sonora-v0.3.0): Rust UB. Check 0.4 or earlier fix. Upgrade only if removed or disableable; verify capture/render.
- TS transport/compaction adaptations: compare Pi stock provider and `core/src/client.rs`, `core/src/client_common.rs`, `core/src/compact_remote_v2*.rs`, `codex-api/src/endpoint/responses*`, `codex-api/src/sse/responses*`, `responses-api-proxy/`, `models-manager/models.json`. Reviewed deltas: `UPSTREAM_SYNC.md`.
- `vendor/js-tiktoken/` and `vendor/tree-sitter-bash/`: npm tarballs pinned in own `UPSTREAM` files. Selected encodings/WASM only; no native install hooks.
