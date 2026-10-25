---
"@howaboua/pi-codex-conversion": patch
---

- Removed built-in Notes/history tools, rollover settings and legacy Remote mode. Install pi-notes-compaction for notes, history and context windows; use /notes for their settings.
- Existing PCC Notes configurations block turns until Notes is loaded or Notes continuity is explicitly disabled in the old configuration.
- Removed the context-sharing API. Integrations must use pi-notes-compaction/context-sharing for shared notes and history, and pi-codex-conversion/agent-relationship for native parent linkage and cache affinity. Parent linkage and cache affinity do not require Notes.
- Added read-only context projection for isolated consumers through the compaction API.
- Removed Cached WebSocket upgrade. PCC now honours Pi's transport setting. Select auto or websocket-cached to retain cached continuation when previously using plain websocket.
- WebSocket prewarming uses the final prepared request, including after compaction; cache keepalive remains opt-in.
- Native checkpoint replay preserves context edits made by other extensions.
- Removed redundant instructions from Notebook help.
- Added optional TS mode with type-checked TypeScript, a persistent live kernel, isolated concurrent cells and durable state controls. Code and Deno Notebook remain available.
- Realtime voice now uses gpt-live-1.1-codex.
