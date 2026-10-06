---
"@howaboua/pi-shepherdr": patch
---

Delegated agents keep reporting after task completion, including follow-up work.

- Added board awareness once per context window across native, Code and Notebook modes. Main agents consider shared context before delegating, while members learn whether the board has existing discussion. Joining or re-enabling a board also refreshes awareness without creating a board or loading its posts into context.
- Orchestration guidance now returns after context rollover or compaction, including worker-message turns, without repeating a retained mode-change notice.
- Restores active agents, exact routing targets and delegated tasks after Pi compaction and Codex context rollover to prevent duplicate work.
- Added asynchronous Ask notifications and answers while workers continue, preserving their task watches. Answers wait briefly for the exact persisted response instead of reporting an uncertain result before Ask saves it.
- Updated agent guidance to close finished workers silently instead of waking them with completion acknowledgements or shutdown notices.
