---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-codex-conversion": patch
---

Added opt-in shared agent notes and history across spawned sessions.

- **Share subagent context** under `/codex context` is off by default and controls new spawns only.
- Shepherdr starts ordinary Pi sessions, then binds unique, persistent context identities before each shared child's first task; shared nested spawns stay in the same family.
- Parents join the shared family only after a child accepts its binding. Forked children receive their own agent name without cutting inherited conversation.
- Remote sharing uses the same Codex account. Local and Tree route through live owner sessions and SSH connections, with explicit unavailable-route errors.
- Cancellation propagates through SSH context routes without disconnecting the machine. An already-completed note write is not rolled back.
- Added an optional context-sharing API for other subagent extensions. Both packages remain independently usable; existing agents are not rebound.
