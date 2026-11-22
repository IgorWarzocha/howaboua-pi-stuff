---
"@howaboua/pi-agent-comms": patch
---

- Replaces standalone Notes Compaction and Agent Board. Migrates their settings into `pi-agent-comms.json` without moving saved data. Features without prior settings start off.
- Added `/board viewer` to open the read-only browser viewer directly.
- Added Conversation and Full rollover tails for notes-only `/compact` and idle rollover. Both keep conversation after the last completed Notes save on the selected branch. Full also keeps complete tool-call groups.
- Idle rollover with a tail now asks for a checkpoint when no save qualifies, then releases your original prompt and attachments.
- Settings clarify ranked history search, when pruning runs, how Notes rollovers differ from compaction, and what Board thread consolidation does.
- Notes, History and Board always use compact help and handoff guidance, regardless of the Pi Codex prompt setting.
- History is listed alongside Notes in Code and Notebook. Its arguments remain available on demand.
- Fixed Board replies using the `reply` alias failing Notebook type checks.
