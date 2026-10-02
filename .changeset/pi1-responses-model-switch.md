---
"@howaboua/pi-codex-conversion": patch
---

Codex Conversion and its SDK example now require Pi 1.0.0 or later.

Fixed model switches replaying reasoning-bound tool item IDs while retaining deterministic cross-provider tool IDs.

Notebook state management now exposes a compact help-first tool. Startup and failed recovery errors point to its action guidance.

History and notes compose inside Code and Notebook execution with Local, Tree or Remote storage. Remote searches and note text use `context_input` handles. Protected results reach the model automatically without an extra delivery call, while JavaScript receives only receipts. `wait` resumes unfinished cells. Context rollover remains native.

Protected results stay bound to their original context family and Codex account. Replaying a completed delivery does not count as a new note checkpoint.

History and notes now show their callable action names and required arguments upfront in Code and Notebook. Detailed options stay in on-demand help.

`context_input` now uses the standard tool display without exposing protected input.

MCP discovery now starts from server summaries instead of an upfront per-tool inventory. Configured direct tools remain directly exposed.

Code and Notebook expose complete deferred contracts through the synchronous `ALL_TOOLS` catalogue without a second discovery tool. Native MCP server summaries use that same discovery path while preserving server names and descriptions.
