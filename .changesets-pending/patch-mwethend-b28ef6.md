---
"@howaboua/pi-shepherdr": patch
---

- Worker guidance now explains automatic final-reply delivery and skips duplicate completion messages.
- Fix resumed workers failing during startup with an unavailable-owner error after a crash or restart.
- Resumed workers keep automatic completion reporting unless explicitly unwatched.
- Shepherdr now skips empty completion notices from unassigned worker turns.
- Agent guidance now keeps delegation outcome-focused and limits peer messaging to actionable handoffs, blockers and ownership conflicts.
