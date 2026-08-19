---
"@howaboua/pi-codex-conversion": patch
---

Keep idle Codex cache refreshes on the exact provider request that produced the active cache, every 25 minutes, without disturbing the live WebSocket continuation or presenting `generate:false` usage as cache telemetry.
