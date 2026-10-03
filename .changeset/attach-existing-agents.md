---
"@howaboua/pi-shepherdr": patch
---

Added `attach` and `detach` actions to `agents` for existing Pi agents.

- Context access and shared-board membership are independent choices and persist across resume.
- Local and Tree notes/history remain under their original identities. Attached agents use aliases to access each other's context.
- Board attachment preserves previous board archives and supports posts, replies and notifications.
- Detachment retains read-only counterpart checkpoints under their existing aliases. If an attached owner exits, checkpoint reads use its reachable saved session or a timestamped retained snapshot with an explicit staleness warning.
- Remote notes/history attachment is unsupported. Board-only attachment remains available.
