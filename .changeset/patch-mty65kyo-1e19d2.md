---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-gippity-control": patch
"@howaboua/pi-shepherdr": patch
---

Fixed reasoning continuity through compaction and missing voice replies.

- V2 compaction preserves the preceding request's reasoning configuration, then starts a fresh baseline without stale overrides. Astra's temporary effort survives continued work across context windows.
- Worker updates now accept up to 8 KiB without truncation announcements or offers to read the rest.
- Reasoning-summary forwarding now recognizes GPT-6 models.
- Replies resume in voice after a context-window rollover, and carried transcripts no longer falsely report that the user ended the call.
- Added an opt-in Notebook plain command output toggle under `/codex Tools`, keeping command metadata while printing output without JSON escaping.
