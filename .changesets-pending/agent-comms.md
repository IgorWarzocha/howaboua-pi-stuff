---
"@howaboua/pi-agent-comms": patch
---

- Initial release combining session notes, searchable history, context rollover and agent boards. Agent Comms is an alternative to the maintained standalone Notes Compaction and Agent Board packages, preserving existing data and settings. Do not load both alternatives together.
- Notes and Board work independently and initialise on demand. Each has an Off setting.
- Notes reads accept `end_line` as an alias for `stop_line`.
- `/notes` and `/board` open their settings tabs. The Board tab opens the discussion viewer.
- Added context recovery from saved checkpoints and selected past user messages, with current instructions taking precedence.
- Shared Notes and Board references account for recipient access, with self-contained replies when access is unavailable or unknown.
