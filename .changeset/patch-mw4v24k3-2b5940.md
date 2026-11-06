---
"@howaboua/pi-notes-compaction": patch
---

- Shared local checkpoints remain readable after workers close. Saved family lookup no longer depends on a live parent when the saved session is accessible locally.
- Saved Notes and History reads are faster in sessions with large messages or tool results.
- Shared saved-session reads no longer fail when the active session appends new entries.
