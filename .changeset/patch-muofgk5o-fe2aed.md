---
"@howaboua/pi-codex-conversion": patch
---

Notebook state guidance now follows the active context, and completion notes are reserved for substantial work.

- Fixed missing Notebook state notices after compaction and notes-based rollover, including automatic continuations
- Brief clarifications, routine lookups and unchanged state no longer request completion notes; explicit checkpoints still apply
- Renamed the hybrid continuity setting to Notes + history + compaction; history lookup and saved settings are unchanged
