---
"@howaboua/pi-shepherdr": patch
---

- Added /herdr close-idle to gracefully close idle children spawned by the current session branch, leaving attached and busy sessions open.
- Clarified that background agent reports arrive automatically without polling or artificial waits, while blocking calls still need awaiting.
