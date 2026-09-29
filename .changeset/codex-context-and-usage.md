---
"@howaboua/pi-codex-conversion": patch
---

Added independent context controls, opt-in agent sharing and persistent Codex usage tracking.

- Added GPT-6.1 Sol with Responses Lite, native reasoning updates, published API pricing and a 272K default context window. Supported reasoning levels run from `low` through `max`, without `off` or `minimal`.
- `/codex context` now separates continuity, Local, Tree or Remote storage, and Pi summary, Codex V2 or Both compaction. Existing settings migrate automatically, and strategy changes preserve the current conversation and usable checkpoints.
- Added shared notes and history for newly spawned agents through Shepherdr or compatible extensions. Sharing is off by default.
- Notes-based continuity now instructs delegated agents to save findings and open work before reporting their results, with note paths in the reply.
- Notes-only `/compact` now reuses fresh notes or requests a note-saving run, then opens a new window without starting another turn.
- `/codex usage` now shows API-equivalent spend and tokens by model and reset window, estimated quota shares, and spend-rate comparisons with the previous window and month. A one-time local-history import seeds initial estimates, with incomplete coverage kept visible.
- Added tracking for renamed Codex providers. Usage and reset requests follow configured endpoints and headers, with an accuracy warning for nonstandard configurations.
- Added `/codex usage analyse` for read-only long-term trends and session-based reasoning reports.
- Codex requests now honor server retry deadlines within the three-minute recovery limit, stop on unavailable Flex capacity and skip redundant warmups on ready WebSockets.
- Code and Notebook modes automatically expose Pi 0.99.1 MCP tools and resources through `tools` and `ALL_TOOLS`, preserving Pi permissions and full MCP results. Ordinary extensions still opt in separately; Pi's built-in `codemode` is disabled while these modes are active and restored afterward.
- Deferred tools now announce their names and short descriptions at startup, with incremental availability updates when tools change and a fresh inventory after context rollover.
- Notebook startup status and deferred-tool notices now show compact state and tool-count summaries in Pi's theme, expand with Ctrl+O and toggle individually when clicked in fullscreen mode.
- Fixed acceptance of incomplete or ambiguous Responses tool calls.
- Fixed Fast Mode cost estimates when the backend reports the `fast` tier.
- Failed browser login callbacks now stop promptly and show the provider error.
- Codex stream events now reach Pi extensions on HTTP and WebSocket transports, without retrying generation when an observer fails.
- Structured, Code and Notebook modes now use shorter instructions and tool schemas. Skill catalogs no longer use Codex-prefixed tags or redundant headings. Bundled reviewer prompts request findings without issue-count targets.
