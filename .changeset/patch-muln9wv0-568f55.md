---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-codex-conversion": patch
---

Added shared agent notes and history across spawned sessions.

- Shepherdr assigns unique, persistent context identities before each child's first turn; nested spawns share the same family.
- Remote sharing uses the same Codex account. Local and Tree route through live owner sessions and SSH connections, with explicit unavailable-route errors.
- Added an optional context-sharing API for other subagent extensions. Both packages remain independently usable; existing agents are not rebound.
