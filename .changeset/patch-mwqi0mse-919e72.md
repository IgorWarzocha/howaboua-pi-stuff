---
"@howaboua/pi-agent-comms": patch
---

- Replaces standalone Notes Compaction and Agent Board. Remove the old extensions when switching. Their settings move to `pi-agent-comms.json`; saved data stays in place. Features without prior settings start off.
- Added `/board viewer` to open the read-only browser viewer directly.
- Added Conversation and Full rollover tails for notes-only `/compact` and idle rollover. Both keep conversation after the last completed Notes save on the selected branch. Full also keeps complete tool-call groups.
- Idle rollover with a tail now asks for a checkpoint when no save qualifies, then releases your original prompt and attachments.
- Settings clarify ranked history search, when pruning runs, how Notes rollovers differ from compaction, and what Board thread consolidation does.
- Code and Notebook list History alongside Notes. Notes, History and Board use compact help in every prompt mode.
- Notes help shows which fields list, search, read and write return.
- Fixed Board replies using the `reply` alias failing Notebook type checks.
