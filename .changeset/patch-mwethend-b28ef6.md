---
"@howaboua/pi-shepherdr": patch
---

- Fixed resumed workers failing to start or losing completion reports after crashes or restarts.
- Fixed agent launches and window focus in standalone Bun builds of Pi.
- Sender labels now show machine, full agent address and terminal without repeated labels.
- Empty turns from unassigned workers no longer trigger completion notices.
- Agent guidance now favours outcome-focused delegation, actionable handoffs and fewer duplicate completion messages.
- Tool examples no longer prescribe `await`.
- New general profiles use GPT-6.2 Sol.
