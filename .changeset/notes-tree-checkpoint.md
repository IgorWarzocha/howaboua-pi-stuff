---
"@howaboua/pi-notes-compaction": patch
---

### Features

- Added per-session auto-pruning in `/notes`, with 5, 10 or 25 full-history windows and optional one-week or one-month conversation retention. Off by default, with a Run now preview. Current context and saved notes remain protected. Restart Pi for memory savings; `/reload` is not sufficient.
- Added opt-in BM25-ranked history search in `/notes` for earlier user messages and assistant replies. Current context, tools and reasoning are excluded. Explicit tool-history, live-window and cross-agent searches retain literal matching.
- Added subagent sharing and note-save marker settings to `/notes`, with migration from global and trusted-folder PCC preferences.
- Added automatic read-only remote notes retrieval and recovery of saved PCC Tree history.
- Added `pi-notes-compaction/context-sharing` with `connectNotesContextSharing` for orchestrators to share notes and history without PCC.

### History and recovery

- Reduced memory use during Notes rollover in long sessions. Earlier windows remain accessible through History and Tree.

  **Expected compaction card:** This fix requires a native history cut, which displays Pi's compaction card. Pi currently provides no supported way to hide this card. It can be ignored; Notes is working as intended.

- Tool descriptions now explain that Notes hands off task state between context windows. GPT prompt mode uses note-style guidance, history-search help and rollover reminders.
- Notes guidance now directs each agent to keep checkpoints and reports in its own notes and share their paths.
- Notes now accepts `read` as an alias for `read_file`.
- With PCC, plaintext Notes and history calls inside `exec` now return objects instead of JSON strings.
- With PCC, history now reads Pi session files instead of encrypted backend history.
- Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
- Prune missing sessions now also removes history index entries for missing session files.
- Notes results now omit storage and routing bookkeeping while retaining read ranges, truncation and warnings about incomplete or outdated results.
