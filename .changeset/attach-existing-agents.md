---
"@howaboua/pi-shepherdr": patch
---

Manage orchestration, board defaults and SSH connections in `/herdr`, and attach existing agents without replacing their context.

### Control panel

- `/herdr` opens Settings, Status and Connections instead of toggling orchestration. Panel controls replace `/herdr board` and `/herdr connect`; outside the TUI, `/herdr` reports status without changes.
- Add SSH machines through Herdr's interactive setup, preserving its installation approvals and machine catalog. Inspect connection errors and reconnect from Status.
- Fixed board startup when the global agent directory overlaps the launch folder's `.pi` directory. The global config is no longer mistaken for folder config.

### Agent attachment

- `agents` gains `attach` and `detach` with independent context and board choices that persist across resume. Agent management stays in the tool, not the human panel.
- Local and Tree notes/history retain their original identities and use aliases for shared access. Board attachment preserves previous archives.
- Detachment retains read-only counterpart checkpoints. After an owner exits, reads use its reachable saved session or a timestamped retained snapshot with an explicit staleness warning. Counterpart history still needs its live owner.
- Remote notes/history attachment is unsupported; board-only attachment remains available.
