---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-subagent-review": patch
---

Restore full extension prompt preparation when continuing into a new context window or starting review triage.

- Keep tool instructions current through Pi's normal startup hooks without resetting the Notebook.
- Let active context management own review-loop navigation summaries.
