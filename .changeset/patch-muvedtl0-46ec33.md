---
"@howaboua/pi-shepherdr": patch
---

Delegated agents keep reporting after task completion, including follow-up work.

- Added board awareness once per context window across native, Code and Notebook modes. Main agents consider shared context before delegating, while members learn whether the board has existing discussion. Joining or re-enabling a board also refreshes awareness without creating a board or loading its posts into context.
- Orchestration guidance now returns after context rollover or compaction, including worker-message turns, without repeating a retained mode-change notice.
