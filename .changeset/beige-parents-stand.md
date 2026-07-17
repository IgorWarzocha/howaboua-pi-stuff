---
"@howaboua/pi-codex-conversion": patch
---

Restore Code Mode tool execution for configured OpenAI Responses providers on Pi 0.80.8 and newer by routing their streams through the custom-tool parser. Persist settings atomically and make existing Code Mode history safe to resume after the mode is disabled.
