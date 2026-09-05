---
"@howaboua/pi-codex-conversion": patch
---

Fixed empty Notebook tool enumeration. `Object.keys(tools)` and membership checks now reflect callable tools; `ALL_TOOLS` remains limited to deferred tools.
