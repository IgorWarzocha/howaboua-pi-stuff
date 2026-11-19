---
"@howaboua/pi-codex-conversion": patch
---

- Fixed TS mode rejecting empty-object help calls accepted by Code and Notebook.
- Code and Notebook no longer save a second copy of images already included in the tool result.
- Codex Responses Lite preserves more screenshot detail, up to Codex's 6,000-pixel and 10,000-patch limits.
- Reduced memory use when preparing image-heavy Codex requests and continuing WebSocket sessions. Remote image validation reuses prepared images across turns.
- Codex honours `Retry-After` in streamed errors on WebSocket and SSE.
