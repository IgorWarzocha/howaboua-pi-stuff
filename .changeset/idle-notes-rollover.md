---
"@howaboua/pi-codex-conversion": patch
---

Added an opt-in 25-minute idle rollover for Notes and history in `/codex context`. With Local, Tree or Remote storage, the next prompt opens a new window first only when the last completed run saved fresh notes successfully. The setting is off by default and does not assume provider-cache expiry.
