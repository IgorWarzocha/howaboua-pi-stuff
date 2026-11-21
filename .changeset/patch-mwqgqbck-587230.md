---
"@howaboua/pi-codex-conversion": patch
---

- Codex falls back to HTTP for the session when a request exceeds the advertised WebSocket limit or the server closes with code 1009 before sending text.
- Codex reports an incomplete response without replaying it when a WebSocket size rejection follows visible output.
- Codex settings clarify what prompt overwrite, cache keepalive and voice refresh change, and which tool naming changes are display-only.
- Background shell completion notices collapse to one line. Expand a notice to see its output.
