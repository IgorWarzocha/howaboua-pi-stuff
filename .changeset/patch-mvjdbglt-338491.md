---
"@howaboua/pi-codex-conversion": patch
---

- Removed built-in Notes/history tools, rollover settings and legacy Remote mode. Install pi-notes-compaction for notes, history and context windows; use /notes for their settings.
- Existing PCC Notes configurations block turns until Notes is loaded or Notes continuity is explicitly disabled in the old configuration.
- Removed the context-sharing API. Integrations must use pi-notes-compaction/context-sharing for shared notes and history, and pi-codex-conversion/agent-relationship for native parent linkage and cache affinity. Parent linkage and cache affinity do not require Notes.
- Added read-only context projection for isolated consumers through the compaction API.
- Removed Cached WebSocket upgrade. PCC now honours Pi's transport setting. Select auto or websocket-cached to retain cached continuation when previously using plain websocket.
- WebSocket prewarming uses the final prepared request, including after compaction; cache keepalive remains opt-in.
- Fixed temporary SSE fallback surviving a context-window rollover. New windows retry the configured WebSocket transport.
- Native checkpoint replay preserves context edits made by other extensions.
- Removed redundant instructions from Notebook help.
- Added optional TS mode with type-checked TypeScript, a persistent live kernel, isolated concurrent cells and snapshot/restore helpers for retained objects. Code and Deno Notebook remain available.
- Added JS Notebook with persistent JavaScript, full VM checkpoints, isolated candidates, selective data profiles, project pins, release controls and closure-preserving hooks.
- Realtime voice now uses gpt-live-1.1-codex.
- Notebook runtime failures retain recovery actions without exposing internal protocol diagnostics.
- Conversation history preparation now allocates fewer temporary objects.
- Fixed Code, Notebook and reasoning tools reappearing after `/tree` when disabled.
- Notebook and TS guidance now limits retained state to planned reuse and calls for cleanup when tasks finish.
