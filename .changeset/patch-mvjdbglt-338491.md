---
"@howaboua/pi-codex-conversion": major
---

- Removed built-in Notes/history tools, rollover settings and legacy Remote mode. Install pi-notes-compaction for notes, history and context windows; use /notes for their settings.
- Existing PCC Notes configurations block turns until Notes is loaded or Notes continuity is explicitly disabled in the old configuration.
- Shared-context integrations now use pi-notes-compaction/context-sharing. Native parent linkage uses pi-codex-conversion/agent-relationship independently of Notes.
- Removed Cached WebSocket upgrade. PCC now honours Pi's transport setting. Select auto or websocket-cached to retain cached continuation when previously using plain websocket.
- WebSocket prewarming uses the final prepared request, including after compaction; cache keepalive remains opt-in.
- Native checkpoint replay preserves context edits made by other extensions.
