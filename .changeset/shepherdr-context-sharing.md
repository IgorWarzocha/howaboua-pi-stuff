---
"@howaboua/pi-shepherdr": patch
---

Added opt-in shared notes and history for spawned agents with Pi Codex Conversion.

- New and nested workers receive distinct, persistent context identities before their first task.
- Local and Tree context stays in its owning sessions and routes through live controllers and existing SSH connections. Remote storage sharing requires the same Codex account.
- Sharing follows **Share subagent context** under `/codex context` and affects new spawns only. Existing agents and ordinary delegation remain unchanged.
- Wakeups of existing agents now say “Continue, unless awaiting for user approval.” Fresh-agent startup is unchanged.
- Fixed spawned agents dispatching before their persistent Pi session is registered. Profiles using `--no-session` now fail before creating a tab or workspace.
- Delegated tasks now guide workers to finish or report blockage with an assistant reply, reserving peer messages for useful mid-run updates rather than waiting or taking over orchestration.
- Peer messages now reach the receiving agent's active voice as brief updates, alongside completion reports. Task dispatches and slash commands are not announced.
