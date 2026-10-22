---
"@howaboua/pi-codex-conversion": patch
---

- Removed Cached WebSocket upgrade. PCC now honours Pi's transport setting. Select auto or websocket-cached to retain cached continuation when previously using plain websocket.
- WebSocket prewarming now follows the selected transport, independently of opt-in cache keepalive.
