---
"@howaboua/pi-codex-conversion": patch
---

Requires Pi 1.0.0 or later.

- Notebook management now uses `{"input":"help"}` and JSON actions through `input`, with guidance for startup recovery.
- Added `tools.history` and `tools.notes` inside Code and Notebook for Local, Tree and Remote storage. Remote inputs are visible in execution source and traces; encrypted results reach the model without exposing their contents to JavaScript. Native Remote calls retain encrypted inputs.
- Added optional **New window after 25 minutes idle** under `/codex context`. With Notes and history, the next prompt opens a new window only when the last completed run saved fresh notes. Incoming agent messages use the same rollover checks.
- Tree navigation now loads saved handoff notes before resuming. Failed reads cancel the jump.
- Fixed low-context reminders restarting completed replies.
- MCP discovery now starts from server summaries with complete contracts in `ALL_TOOLS`. Promoted custom-tool changes and removals are announced before the next request.
- Fixed Usage history loading when Pi and the extension are installed separately. Standalone ledger reports require `--file`; session scans require `--root`.
- Fixed conversation replay across Responses model and execution-mode changes.
- Fixed voice progress and final replies when realtime voice starts during ongoing Pi work.
- Added `xhigh` and `max` to Auto reasoning's `change_reasoning` tool.
- WebSocket setup now overlaps request preparation. Compaction warmup reconnects dropped sockets and reuses matching history.
- Updated the Sites custom-tool example with Site-hosted MCP guidance, slug changes, Worker logs, database reads, schedules and atomic private-source publishing with saved-version recovery.
