---
"@howaboua/pi-agent-comms": patch
---

- Initial release combining session notes, history, context rollover and agent boards. Replace Notes Compaction and Agent Board with Agent Comms; existing data and settings remain in place.
- `/notes` and `/board` open their respective settings tabs. Open the Board viewer from its tab.
- Notes and Board initialise independently on demand. Notes adds an Off setting without changing existing defaults.
- Notes now accepts `content` as a body alias for `text` in typed tool calls.
- Notes results omit routine bookkeeping while retaining note paths, content, search matches and truncation.
- Notes guidance consolidates changed checkpoints near the end of substantive turns.
- Worker handoffs now use brief replies with checkpoint paths. Parents read Notes for details.
- Notes and Board guidance adapts to the enabled features, with one shared routing contract when both are on.
