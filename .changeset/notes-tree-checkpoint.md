---
"@howaboua/pi-notes-compaction": patch
---

### Breaking changes

- **BREAKING CHANGE:** PCC integration now requires PCC 4.0.5 or newer.
- **BREAKING CHANGE:** Notes and history now return plaintext results as objects in Code and Notebook. Remove `JSON.parse` around these results in saved helpers. Encrypted notes still return delivery receipts.

### Features

- Added opt-in Ranked history search in `/notes` for earlier user messages and assistant replies. Current context, tools and reasoning are excluded. Explicit tool-history, live-window and cross-agent searches retain literal matching.
- Added subagent sharing and note-save marker settings to `/notes`, with migration from global and trusted-folder PCC preferences.
- Notes now owns automatic read-only remote notes retrieval and saved Tree-history recovery.
- Added the context-sharing API for orchestrators to connect shared notes and history independently of PCC.

### History and recovery

- Notes window rollover now reduces memory pressure in long sessions without removing saved history.
- History now reads Pi JSONL sessions instead of fetching encrypted backend history.
- Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
- Prune missing sessions now also removes history index entries for missing session files.
- Notes results now omit storage and routing bookkeeping while retaining read ranges, truncation and warnings about incomplete or outdated results.
