---
"@howaboua/pi-notes-compaction": patch
---

- PCC integration now requires PCC 4.0.5 or newer.
- Added the context-sharing API for orchestrators to connect shared notes and history independently of PCC.
- Notes now owns automatic read-only remote retrieval and saved Tree-history recovery.
- Added subagent sharing and note-save marker settings to /notes, with migration from global and trusted-folder PCC preferences.
- Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
