---
"@howaboua/pi-codex-conversion": patch
---

Rejig Codex settings into General, Tools, OpenAI, Usage, and About tabs with grouped config migration, wire PATH mode to the shell-only Codex tool surface, expose web/image tools as flat `web_run` and `imagegen` tools, and resolve `web_run` provider/auth data in the adapter before invoking the native helper.
