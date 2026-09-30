---
"@howaboua/pi-shepherdr": patch
---

Agent profiles now control delegation waiting and shared context.

- Removed reviewer-name blocking rules. Optional profile `blocking` forces blocking or asynchronous spawns, and help and list report the configured policy with the profile description.
- Added `share_context: false` for independent subagent notes and history. Existing installed profiles remain unchanged.
