---
"@howaboua/pi-notes-compaction": patch
---

- Added Conversation and Full rollover tails for notes-only `/compact` and idle rollover. Both keep conversation after the last completed Notes save on the selected branch. Full also keeps complete tool-call groups.
- Idle rollover with a tail now asks for a checkpoint when no save qualifies, then releases your original prompt and attachments.
- Notes settings clarify ranked history search, when pruning runs and how Notes rollovers differ from compaction.
- Notes and History always use compact help and rollover guidance, regardless of the Pi Codex prompt setting.
- History is listed alongside Notes in Code and Notebook. Its arguments remain available on demand.
