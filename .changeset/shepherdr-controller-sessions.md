---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-shepherdr2": patch
---

Keep agent orchestration scoped to the explicitly activated Pi session.

Bare `/herdr` now activates the agent fleet and toggles one-time orchestration guidance. Resumed controllers restore their mode from session history, while new workers remain dormant even when launched from the same directory.
