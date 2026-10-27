---
"@howaboua/pi-notes-compaction": patch
---

### Breaking changes

- **BREAKING CHANGE:** When used with PCC, plaintext Notes and history calls inside `exec` now return objects. Remove `JSON.parse` around these calls in saved helpers. Standalone Notes is unaffected.

### Features

- Added opt-in BM25-ranked history search in `/notes` for earlier user messages and assistant replies. Current context, tools and reasoning are excluded. Explicit tool-history, live-window and cross-agent searches retain literal matching.
- Added subagent sharing and note-save marker settings to `/notes`, with migration from global and trusted-folder PCC preferences.
- Added automatic read-only remote notes retrieval and recovery of saved PCC Tree history.
- Added `pi-notes-compaction/context-sharing` with `connectNotesContextSharing` for orchestrators to share notes and history without PCC.

### History and recovery

- Fixed long sessions exhausting memory after Notes rollover. Earlier windows remain accessible through History and Tree.
- Notes now accepts `read` as an alias for `read_file`.
- With PCC, history now reads Pi session files instead of encrypted backend history.
- Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
- Prune missing sessions now also removes history index entries for missing session files.
- Notes results now omit storage and routing bookkeeping while retaining read ranges, truncation and warnings about incomplete or outdated results.
