---
"@howaboua/pi-codex-conversion": patch
---

Fixed normal compaction alongside notes and history.

- Pi automatic compaction and `/compact` now stay in the current window with Notes + history + compaction. Explicit `new_context` still compacts before rollover.
- Added **Use notes for tree summaries**, on by default. Turning it off uses Pi's ordinary branch summary without a note-writing run.
- Added Local and Tree notes/history access for existing agents attached through Shepherdr, preserving their original identity and read-only checkpoint access after detachment or owner exit.
- Removed static environment, history availability and summary claims from context rollover messages.
