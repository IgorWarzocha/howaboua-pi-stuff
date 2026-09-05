---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-codex-imagegen": patch
---

Fix worker settlement, custom model preservation, and prompt-only image generation.

- Settle Shepherdr workers after Pi expands skill or prompt-template invocations.
- Preserve custom Codex models and `models.json` overrides, including after refresh.
- Keep optional tool arguments optional in Codex Responses requests while preserving explicit strict sampling.
- Treat null image selectors as absent, so prompt-only requests generate rather than edit.
- Honor the details toggle in Notebook Mode to hide duplicate output previews.
- Show submitted messages without waiting for cached WebSocket warmup, while keeping generation serialized behind it.
