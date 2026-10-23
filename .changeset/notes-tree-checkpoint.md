---
"@howaboua/pi-notes-compaction": patch
---

- PCC integration requires PCC 5 or newer. Notes now owns shared notes/history, automatic read-only remote retrieval and saved Tree-history recovery.
- Added subagent sharing and note-save marker settings to /notes, with migration from PCC preferences.
- Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
