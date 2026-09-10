---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-codex-conversion": patch
---

Fixed idle agent reports and manual checkpoint requests to preserve prompt preparation, coalesce concurrent continuations, and process reports arriving during turn settlement.

- Manual Compact reuses notes saved in the last completed turn for Local, Tree, and Remote notes-only windows, avoiding a redundant checkpoint turn. Explicit compaction instructions still request a checkpoint.
