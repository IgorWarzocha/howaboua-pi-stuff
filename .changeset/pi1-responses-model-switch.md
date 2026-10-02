---
"@howaboua/pi-codex-conversion": patch
---

Codex Conversion and its SDK example now require Pi 1.0.0 or later.

- Fixed reasoning-bound tool IDs on model switches while retaining deterministic cross-provider IDs. Historical custom `exec` calls and receipts preserve their recorded wire shape across execution-mode changes.
- Notebook state management now has compact help-first guidance, including recovery from startup failures.
- History and notes now compose inside Code and Notebook with Local, Tree or Remote storage. Remote calls accept query and note text directly in JavaScript. Direct native tools retain encrypted inputs.
- Protected Remote results now reach the model through their originating `exec`, including after `wait`, while JavaScript receives only receipts. Results remain bound to their original context family and Codex account. Replay does not count as a new note checkpoint.
- Tree navigation now loads its handoff note before resuming, without an extra model turn to read it. Failed reads cancel the jump, and Remote results stay encrypted through replay and compaction.
- History and notes now show callable actions and required arguments upfront. Complete deferred contracts use the synchronous `ALL_TOOLS` catalogue without a second discovery tool.
- MCP discovery now starts from server summaries and uses `ALL_TOOLS` in Code and Notebook. Server names and descriptions are preserved, and configured direct tools stay direct.
