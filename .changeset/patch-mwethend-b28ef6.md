---
"@howaboua/pi-shepherdr": patch
---

- Messages and task handoffs identify the sender by machine, full agent address and terminal without repeating workspace, tab or display labels.

- Worker guidance now explains automatic final-reply delivery and skips duplicate completion messages.
- Fix resumed workers failing during startup with an unavailable-owner error after a crash or restart.
- Resumed workers keep automatic completion reporting unless explicitly unwatched.
- Shepherdr now skips empty completion notices from unassigned worker turns.
- Agent guidance now keeps delegation outcome-focused, limits peer messaging to actionable handoffs, blockers and ownership conflicts, and directs workers back to their assigned work after coordination.
- Fixed agent launches and window focus when Pi runs as a standalone Bun executable.

- Agent tool examples now omit mode-specific `await` syntax.
