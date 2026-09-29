---
"@howaboua/pi-codex-conversion": patch
---

Added independent context controls, opt-in agent sharing and persistent Codex usage tracking.

- Added GPT-6.1 Sol with Responses Lite, native reasoning updates, published API pricing and a 272K default context window. Supported reasoning levels run from `low` through `max`, without `off` or `minimal`.
- `/codex context` now separates continuity, Local, Tree or Remote storage, and Pi summary, Codex V2 or Both compaction. Existing settings migrate automatically, and strategy changes preserve the current conversation and usable checkpoints.
- Added shared notes and history for newly spawned agents through Shepherdr or compatible extensions. Sharing is off by default.
- Notes-only `/compact` now reuses fresh notes or requests a note-saving run, then opens a new window without starting another turn.
- `/codex usage` now shows API-equivalent spend and tokens by model and reset window, estimated quota shares, and spend-rate comparisons with the previous window and month. A one-time local-history import seeds initial estimates, with incomplete coverage kept visible.
- Added tracking for renamed Codex providers. Usage and reset requests follow configured endpoints and headers, with an accuracy warning for nonstandard configurations.
- Added `/codex usage analyse` for read-only long-term trends and session-based reasoning reports.
- Codex requests now honor server retry deadlines within the three-minute recovery limit, stop on unavailable Flex capacity and skip redundant warmups on ready WebSockets.
- Structured, Code and Notebook modes now use shorter instructions and tool schemas. Bundled reviewer prompts request findings without issue-count targets.
