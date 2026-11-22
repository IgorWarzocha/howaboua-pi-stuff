---
"@howaboua/pi-codex-conversion": patch
---

- Codex falls back to HTTP for the session when a request exceeds the advertised WebSocket limit or the server closes with code 1009 before sending text.
- Codex reports an incomplete response without replaying it when a WebSocket size rejection follows visible output.
- Codex settings clarify what prompt overwrite, cache keepalive and voice refresh change, and which tool naming changes are display-only.
- Codex prompt guidance now directs agents to work through recoverable blockers, continue independent work and act on clear requests rather than offering to act.
- Code and Notebook list each tool's usage and standing rules together, including argument discovery and shell and patch guidance.
- Codex sends harness and tool guidance before `AGENTS.md` instructions and the working directory.
- Background shell completion notices collapse to one line. Expand a notice to see its output.
