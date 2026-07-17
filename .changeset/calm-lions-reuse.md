---
"@howaboua/pi-codex-conversion": patch
---

Allows Responses compaction v1 and v2 to reuse the same encrypted checkpoint across protocol and model changes when the provider, API, and endpoint match. Native compaction now inherits the active model and reasoning level, while normal model switches preserve backend-verified WebSocket continuation.
