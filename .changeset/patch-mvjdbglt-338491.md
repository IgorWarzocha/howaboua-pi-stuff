---
"@howaboua/pi-codex-conversion": patch
---

### Breaking changes

- **BREAKING CHANGE:** Removed built-in notes, history, rollover settings and legacy Remote mode. Install `pi-notes-compaction` and use `/notes`. Existing Notes-enabled configurations block turns until Notes is loaded or continuity is explicitly disabled in the old configuration.
- **BREAKING CHANGE:** Moved the shared notes and history API from `pi-codex-conversion/context-sharing` to `pi-notes-compaction/context-sharing`. PCC's parent linkage and cache affinity API is now `pi-codex-conversion/agent-relationship`.

### Features

- Added TS Notebook with strict TypeScript checking, persistent bindings, isolated concurrent cells and custom snapshot and restore helpers.
- Added project-shared JS Notebook with full-state checkpoints that preserve closures, classes and cycles, plus isolated concurrent cells, reusable released bindings, profiles, pins and hooks.
- Added GPT-6.1 Terra with Responses Lite and live reasoning adjustments.
- TS and JS Notebook runtimes now install on demand and reuse matching installed packages or cached downloads.
- Realtime voice now uses `gpt-live-1.1-codex`.
- Auto-reasoning guidance now makes effort adjustments optional and clarifies that they apply to the next request.

### Reliability and usability

- Pi's transport setting now replaces the Cached WebSocket upgrade toggle. Select `auto` or `websocket-cached` for cached continuation.
- Fixed temporary SSE fallback surviving a context-window rollover. New windows retry the configured WebSocket transport.
- Fixed Code, Notebook and reasoning tools reappearing after `/tree` when disabled.
- WebSocket prewarming now uses the final prepared request, including after compaction.
- Native checkpoint replay now preserves context edits made by other extensions.
- Notebook failures now retain recovery actions without exposing internal protocol diagnostics.
- Conversation history preparation now allocates fewer temporary objects.
- Notebook and TS guidance now limits retained state to planned reuse and calls for cleanup when tasks finish.
- Removed redundant instructions from Notebook help.
- Added read-only context projection for isolated consumers through the compaction API.
