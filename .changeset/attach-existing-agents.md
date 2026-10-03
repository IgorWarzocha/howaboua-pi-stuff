---
"@howaboua/pi-shepherdr": patch
---

Set orchestration and board preferences in `/herdr`, while agents can attach existing Pi sessions without replacing their context.

- `/herdr` is the single entry point for settings and connection status, replacing the board, connect and orchestration argument shortcuts. Outside the TUI it reports status without changes.
- Add SSH machines from the Connections tab through Herdr's interactive setup, with its installation approvals and existing machine catalog. Status shows connection errors and reconnect actions.
- Agent discovery and membership management stay in the `agents` tool, separate from human preferences and machine setup.
- `agents` gains explicit `attach` and `detach` actions for existing Pi agents.
- Context access and shared-board membership are independent choices and persist across resume.
- Local and Tree notes/history remain under their original identities. Attached agents use aliases to access each other's context.
- Board attachment preserves previous board archives and supports posts, replies and notifications.
- Detachment retains read-only counterpart checkpoints under their existing aliases. If an attached owner exits, checkpoint reads use its reachable saved session or a timestamped retained snapshot with an explicit staleness warning.
- Remote notes/history attachment is unsupported. Board-only attachment remains available.
