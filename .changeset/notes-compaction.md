---
"@howaboua/pi-notes-compaction": patch
---

Requires Node.js 22.19 or newer.

- Notes now offers Off and defers inactive initialisation without deleting saved data or retired context boundaries.
- Notes now accepts `content` as a body alias for `text` in typed tool calls.
- Notes reads now accept `end_line` as an alias for `stop_line`.
- Notes results now omit routine bookkeeping while retaining paths, content, search matches and truncation.
- Context recovery now checks selected past user messages for intent and communication preferences, with current instructions taking precedence.
- Context window openings now omit UUIDs; history still exposes window references.
- Notes guidance now consolidates changed checkpoints near the end of substantive turns.
- Shared notes and history now report recovery options when saved context cannot be accessed.
- History searches no longer retain full rendered copies of tool arguments and messages for the session lifetime.
- Notes now uses minute precision in displayed dates, preserving existing records.
- Replaced the TypeBox dependency with Pi's native schema validation.
