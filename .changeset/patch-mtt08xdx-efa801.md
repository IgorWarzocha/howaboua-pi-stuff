---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-codex-conversion": patch
---

Fixed idle agent reports and manual checkpoint requests to preserve prompt preparation, coalesce concurrent continuations, and process reports arriving during turn settlement.

- Manual Compact reuses notes saved in the last completed turn for Local, Tree, and Remote notes-only windows, avoiding a redundant checkpoint turn. Explicit compaction instructions still request a checkpoint.
- Compact tool output now offers Off, On, and Minimal. Minimal keeps nested tool results and an expand hint while hiding the trailing Code / Notebook text preview until expanded. Existing Off and On settings keep their behavior.
- Shepherdr help makes local routing explicit: agent calls default to the host running Pi, while unfiltered discovery searches all machines. Remote calls use profile IDs, not machine labels or hostnames.
- Fixed Shepherdr startup after a Herdr executable replacement leaves a stale ` (deleted)` path. Recovery uses the same executable location with a visible warning, and command failures no longer imply that Herdr is outdated.
