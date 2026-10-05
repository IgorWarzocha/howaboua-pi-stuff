---
"@howaboua/pi-codex-conversion": patch
---

Fixed the 25-minute idle rollover after aborted or failed runs. Stale notes now trigger a checkpoint before the waiting input starts in a new context window.

- Added opt-in **Note save markers** in `/codex display`, with `/tree` bookmarks on completed replies that saved notes. In **Notes and history**, returning to a bookmarked reply and running `/compact` opens a window without another note-writing turn.
- Fixed manual `/compact` checkpoint requests getting stuck after the idle deadline.
- Added independent Fast Mode settings for Astra, Sol, Terra and Luna in `/codex`, shared across each family's model versions. Existing Fast Mode preferences are preserved.
- Updated `change_reasoning` guidance to prompt effort selection before substantial work and reassessment between phases. The user-selected floor and reset behavior are unchanged.
