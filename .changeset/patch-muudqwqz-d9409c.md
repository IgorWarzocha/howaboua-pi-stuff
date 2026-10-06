---
"@howaboua/pi-codex-conversion": patch
---

Fixed the 25-minute idle rollover after aborted or failed runs. Stale notes now trigger a checkpoint before the waiting input starts in a new context window.

- Added opt-in **Note save markers** in `/codex display`, with `/tree` bookmarks on completed replies that saved notes. In **Notes and history**, returning to a bookmarked reply and running `/compact` opens a window without another note-writing turn.
- Fixed manual `/compact` checkpoint requests getting stuck after the idle deadline.
- Added independent Fast Mode settings for Astra, Sol, Terra and Luna in `/codex`, shared across each family's model versions. Existing Fast Mode preferences are preserved.
- Updated `change_reasoning` guidance to prompt use at task start and when the work changes. The user-selected floor and reset behavior are unchanged.
- Added durable context briefings from extensions, including shared-board status, with replay and compaction support. Extensions can inspect selected context to avoid repeating notices that are still visible.
- Fixed inactive Codex conversion restoring tools disabled by other extensions, including hashline editing.
- Fixed hidden tools' guidelines remaining in the standing prompt with Pi 1.0.4.
- Added request-scoped fetch support and honored zero-retry requests for approval reviewers. Nested tool hooks now retain the original exec call ID across waits.
- Nested approval hooks now inspect prepared arguments, so tool aliases and freeform inputs cannot bypass argument-based approval rules.
- Notes listings now accept `max_files` as an alias for `max_results`. Context briefings flag that more notes may be available and expand in the UI like notebook state and available tools.
