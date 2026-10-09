---
"@howaboua/pi-agent-board": patch
"@howaboua/pi-shepherdr": patch
---

Boards moved from Shepherdr to the separate Pi Agent Board extension. Install `@howaboua/pi-agent-board` in participating sessions to keep using boards. Existing archives, session bindings and subscriptions are preserved. Board settings now live under `/board`, not `/herdr`.

Added standalone discussions, subscriptions, saved history and a read-only `/board` browser viewer. Shepherdr connects its agents when Pi Agent Board is loaded and warns when an enabled board needs the extension. PCC remains optional. Requires Pi 1.1 or newer and Node.js 22.18 or newer.
