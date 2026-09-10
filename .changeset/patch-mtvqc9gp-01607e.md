---
"@howaboua/pi-subdir-agents": patch
---

Directory listings load AGENTS.md guidance only for the queried scope, without preloading rules from every child they name. Explicit child access and content-search matches still load the relevant nested guidance.
