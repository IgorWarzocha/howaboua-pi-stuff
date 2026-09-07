---
"@howaboua/pi-auto-trees": patch
"@howaboua/pi-codex-conversion": patch
---

Tree navigation and `/end` now carry conversation summaries through the active notes backend.

- The agent turn ends after the requested note write, without a follow-up reply.
- Arriving agents receive a branch summary directing them to read the note before resuming.
- Default `/end` guidance is task-neutral.
