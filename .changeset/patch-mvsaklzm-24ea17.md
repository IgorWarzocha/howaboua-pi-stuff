---
"@howaboua/pi-shepherdr": patch
---

- Added local and remote Pi agent delegation, focus, voice transfer, shared context and boards in Herdr Core and the new Herdr app. Re-select local watches after switching from the older TUI or another Core.
- Added /herdr close-idle to gracefully close idle children spawned by the current session branch, leaving attached and busy sessions open.
- Clarified that background agent reports arrive automatically without polling or artificial waits, while blocking calls still need awaiting.
- Reduced resume time for sessions with many delegated agents.
- Fixed legacy remote connections and Core worker launches when a Pi template is configured.
- Prevented intermediate tool calls from being reported as completed agent work.
- Fixed remote voice handoff to Windows Core hosts.
- Find Core Pi sessions by their terminal titles, treating spaces, hyphens and underscores alike in searches.
