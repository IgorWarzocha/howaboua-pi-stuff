---
"@howaboua/pi-codex-conversion": patch
---

Fixed the 25-minute idle rollover after aborted or failed runs. Stale notes now trigger a checkpoint before the waiting input starts in a new context window.

- Added opt-in **Note save markers** in `/codex display`, with `/tree` bookmarks on completed replies that saved notes. In **Notes and history**, returning to a bookmarked reply and running `/compact` opens a window without another note-writing turn.
- Fixed manual `/compact` checkpoint requests getting stuck after the idle deadline.
