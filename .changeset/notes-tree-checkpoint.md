---
"@howaboua/pi-notes-compaction": patch
---

### Breaking changes

- **BREAKING CHANGE:** When used with PCC, plaintext Notes and history calls inside `exec` now return objects. Remove `JSON.parse` around these calls in saved helpers. Standalone Notes is unaffected.

### Features

- Added opt-in Ranked history search in `/notes` for earlier user messages and assistant replies. Current context, tools and reasoning are excluded. Explicit tool-history, live-window and cross-agent searches retain literal matching.
- Added subagent sharing and note-save marker settings to `/notes`, with migration from global and trusted-folder PCC preferences.
- Notes now owns automatic read-only remote notes retrieval and saved Tree-history recovery.
- Added the context-sharing API for orchestrators to connect shared notes and history independently of PCC.

### History and recovery

- Committed context windows now retire old native conversation context before request-time cloning, reducing memory pressure in long sessions while preserving History and Tree access.
- Notes now accepts `read` as an alias for `read_file`.
- History now reads Pi JSONL sessions instead of fetching encrypted backend history.
- Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
- Prune missing sessions now also removes history index entries for missing session files.
- Notes results now omit storage and routing bookkeeping while retaining read ranges, truncation and warnings about incomplete or outdated results.
