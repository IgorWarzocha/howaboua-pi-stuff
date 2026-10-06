---
"@howaboua/pi-codex-conversion": patch
---

Improved context recovery and added Fast Mode controls for all models and individual families.

- Idle rollover now checkpoints stale notes before continuing in a new window, including after aborted or failed runs.
- Added optional **Note save markers** in `/codex display`. Use their `/tree` bookmarks to return to saved checkpoints. In **Notes and history**, plain `/compact` can reuse those notes.
- Added **All models Fast Mode** alongside independent Astra, Sol, Terra and Luna controls in `/codex`. Family choices apply across model versions. Existing preferences are preserved.
- Extension briefings survive compaction and context rollover. Context briefings expand in the UI, and recent-note previews flag that more notes may be available.
- Added Codex Guardian support for Code and Notebook tool calls.
- Inactive Codex conversion preserves other extensions' tool selections. Hidden tools no longer add standing prompt instructions.
- Notes listings accept `max_files` as an alias for `max_results`.
