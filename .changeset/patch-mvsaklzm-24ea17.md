---
"@howaboua/pi-shepherdr": patch
---

- Added local and remote Pi agent delegation in Herdr Core and the new Herdr app. Re-select local watches after switching from the older TUI or another Core. Focus and cross-machine notes and boards are not available on Core.
- Added /herdr close-idle to gracefully close idle children spawned by the current session branch, leaving attached and busy sessions open.
- Clarified that background agent reports arrive automatically without polling or artificial waits, while blocking calls still need awaiting.
