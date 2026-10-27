---
"@howaboua/pi-codex-conversion": patch
---

### Breaking changes

- **BREAKING CHANGE:** Removed built-in notes, history, rollover settings and legacy Remote mode. Install `pi-notes-compaction` and use `/notes`. Existing Notes-enabled configurations block turns until Notes is loaded or continuity is explicitly disabled in the old configuration.
- **BREAKING CHANGE:** Moved the shared notes and history API from `pi-codex-conversion/context-sharing` to `pi-notes-compaction/context-sharing`. PCC's parent linkage and cache affinity API is now `pi-codex-conversion/agent-relationship`.

### Features

- Added isolated Deno Notebook cells that run concurrently from saved checkpoints and save separate profile candidates.
- Added TS Notebook with strict TypeScript checking, persistent bindings, isolated concurrent cells and custom snapshot and restore helpers.
- Added project-shared JS Notebook with checkpoints that preserve closures, classes and cycles, isolated concurrent cells, profiles, pins and hooks.
- Added GPT-6.1 Terra with Responses Lite and live reasoning adjustments.
- TS and JS Notebook runtimes now install on demand and reuse matching installed packages or cached downloads.
- Realtime voice now uses `gpt-live-1.1-codex`.
- Auto-reasoning guidance now makes effort adjustments optional and clarifies that they apply to the next request.

### Reliability and usability

- Fixed SSE retries multiplying to 30 requests after WebSocket fallback. HTTP and stream retries now share one budget, with a five-minute recovery deadline starting at the first retryable failure.
- Codex overload recovery now shares a three-minute elapsed-time limit across WebSocket and SSE.
- SSE fallback now honours overload backoff.
- GPT prompt mode uses dense checkpoint-style runtime guidance and notebook help.
- Tool guidance separates unfamiliar-tool discovery from large reads and limits batching by combined output. Truncated results explain how to recover missing output without repeating side effects.
- Pi's transport setting now replaces the Cached WebSocket upgrade toggle. Select `auto` or `websocket-cached` for cached continuation.
- Fixed temporary SSE fallback surviving a context-window rollover. New windows retry the configured WebSocket transport.
- Fixed Code, Notebook and reasoning tools reappearing after `/tree` when disabled.
- WebSocket prewarming now uses the final prepared request, including after compaction.
- Native checkpoint replay now preserves context changes made by other extensions.
- Notebook failures now retain recovery actions without exposing internal protocol diagnostics.
- Notebook and TS guidance now limits retained state to planned reuse and calls for cleanup when tasks finish.
- Added `pi-codex-conversion/compaction` with context-window preparation, compaction hooks and read-only branch projection.
