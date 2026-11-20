---
"@howaboua/pi-notes-compaction": patch
---

- Fix role switches and context rollover when a temporary reasoning boost expires.
- Show role names and descriptions in a native Pi list in `/roles`.
- Keep the explicitly selected role across context rollovers without inferring it from the model or reasoning level.
- Clarify when agents should switch roles after research and when they can finish in place.
- Remind continuing agents to recover their notes and resume unfinished work after rollover.
- Shorter Notes guidance clarifies the checkpoint required for context rollover.
- Notes reads, lists and searches reuse the same loaded notes.
- Fixed shared Notes reads and lists failing for a remote-backed parent session.
- History reads do less work per page, and ranked searches reuse unchanged search scopes.
