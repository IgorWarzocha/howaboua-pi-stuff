---
"@howaboua/pi-notes-compaction": patch
---

- Notes now offers Off and defers inactive initialisation without deleting saved data or retired context boundaries.
- Notes now accepts `content` as a body alias for `text` in typed tool calls.
- Notes results now omit routine bookkeeping while retaining paths, content, search matches and truncation.
- Context recovery now checks selected past user messages for intent and communication preferences, with current instructions taking precedence.
- Context window openings now omit UUIDs; history still exposes window references.
- Notes guidance now consolidates changed checkpoints near the end of substantive turns.
- Shared notes and history now report recovery options when saved context cannot be accessed.
- History searches no longer retain full rendered copies of tool arguments and messages for the session lifetime.
- Notes now uses minute precision in displayed dates, preserving existing records.
