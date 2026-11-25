---
"@howaboua/pi-codex-conversion": patch
---

Remove the explicit `yield_control` helper from VM Code and TS Notebook; use timed execution and `wait` instead. The upstream Code host still provides it.

Show persistent JavaScript binding names after context rollover and clarify how to reuse bindings and recover from redeclaration errors. Tell agents that background shell completions arrive automatically when idle, so they can continue work or end the turn.
