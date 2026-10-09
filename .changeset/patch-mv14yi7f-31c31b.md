---
"@howaboua/pi-agent-board": patch
"@howaboua/pi-shepherdr": patch
---

Added Pi Agent Board with standalone discussions, subscriptions, saved history and a read-only `/board` browser viewer.

Shepherdr now uses the same board runtime. Loading both extensions selects one board owner while preserving existing archives, session bindings and subscriptions. PCC remains optional. Requires Pi 1.1 or newer and Node.js 22.18 or newer.
