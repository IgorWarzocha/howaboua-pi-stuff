---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-codex-imagegen": patch
"@howaboua/pi-subagent-review": patch
"@howaboua/pi-gippity-control": patch
---

Adapt Codex, Imagegen, review, and GipPity to Pi 0.87.

Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer.

- Fixed Codex prompt and tool updates rewriting the cached conversation prefix.
- Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window.
- Fixed Imagegen recent-image selection ignoring context removals and replacements.
- Fixed review summaries and preface tracking ignoring context removals and replacements.
- Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.
