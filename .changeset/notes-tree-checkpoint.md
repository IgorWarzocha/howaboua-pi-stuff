---
"@howaboua/pi-notes-compaction": patch
---

- PCC integration now requires PCC 4.0.5 or newer.
- Notes and history now return plaintext results as objects in Code and Notebook. Remove JSON.parse around these results in saved helpers. Encrypted notes still return delivery receipts.
- Added the context-sharing API for orchestrators to connect shared notes and history independently of PCC.
- History now reads Pi JSONL sessions instead of fetching encrypted backend history.
- Added opt-in Ranked history search in /notes for earlier user messages and assistant replies. Indexing runs off the UI thread and skips current context, tool activity and reasoning. Explicit tool-history, live-window and cross-agent searches retain literal matching.
- Prune missing sessions now also removes history index entries for missing session files.
- Notes now owns automatic read-only remote notes retrieval and saved Tree-history recovery.
- Added subagent sharing and note-save marker settings to /notes, with migration from global and trusted-folder PCC preferences.
- Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
