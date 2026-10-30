---
"@howaboua/pi-shepherdr": patch
---

- When switching from the older Herdr TUI or another Core instance, reselect local watches.
- Added Herdr Core and Herdr app support for local and remote delegation, focus, voice transfers, shared Notes and boards, including Windows hosts.
- Added Core session discovery by terminal title, with spaces, hyphens and underscores treated alike.
- Added `/herdr close-idle` to close idle children spawned by the current session branch, leaving attached and busy sessions open.
- Spawn results now return `contextAgent` and `boardAgent` inside `sharing` instead of at the top level. The agent `target` is unchanged.
- Reduced resume delays in sessions with many delegated agents, including closed children.
- Remote sharing helpers now start only when sharing is used or restored, avoiding idle polling on unrelated machines.
- Fixed intermediate tool calls being reported as completed agent work.
- Agent guidance now distinguishes automatic background reports from blocking calls that must be awaited.
- Agent tool declarations now accept action fields discovered through help, including in native codemode.
