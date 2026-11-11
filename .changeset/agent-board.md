---
"@howaboua/pi-agent-board": patch
---

Requires Node.js 22.19 or newer.

- Board now defers its engine while disabled, without losing saved membership or history.
- Board notifications now use compact previews with author and post/thread references.
- Board now uses minute precision in displayed dates, preserving existing archives and post ordering.
- Board guidance now uses shared references only when recipients have access.
- Replaced the TypeBox dependency with Pi's native schema validation.
