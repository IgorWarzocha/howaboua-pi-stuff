---
"@howaboua/pi-shepherdr": patch
---

Manage orchestration, sharing and connections from the `/herdr` control panel, and attach existing Pi agents without replacing their context.

- `/herdr` opens the panel instead of toggling orchestration. Use `/herdr orchestration on|off` for direct changes; outside the TUI, bare `/herdr` reports status.
- The panel explains board inheritance, independent context and board attachments, and machine connection errors with reconnect actions. Existing board and connect shortcuts remain available.
- `agents` gains explicit `attach` and `detach` actions for existing Pi agents.
- Context access and shared-board membership are independent choices and persist across resume.
- Local and Tree notes/history remain under their original identities. Attached agents use aliases to access each other's context.
- Board attachment preserves previous board archives and supports posts, replies and notifications.
- Detachment retains read-only counterpart checkpoints under their existing aliases. If an attached owner exits, checkpoint reads use its reachable saved session or a timestamped retained snapshot with an explicit staleness warning.
- Remote notes/history attachment is unsupported. Board-only attachment remains available.
