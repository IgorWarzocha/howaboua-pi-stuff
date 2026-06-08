---
"@howaboua/pi-codex-conversion": patch
---

Rejig Codex settings into General, Tools, OpenAI, Usage, and About tabs with grouped config migration, wire PATH mode to the shell-only Codex tool surface, expose web/image tools as flat `web_run` and `imagegen` tools, and route `web_run` through Pi-owned OpenAI Codex auth using Codex-compatible reqwest transport, headers, endpoint resolution, request shape, recent-input context, PATH credential refresh, hosted Codex `web_search` fallback when standalone alpha/search is unavailable, and failure classification.
