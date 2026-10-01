---
"@howaboua/pi-codex-conversion": patch
---

Codex Conversion and its SDK example now require Pi 1.0.0 or later.

Fixed model switches replaying reasoning-bound tool item IDs while retaining deterministic cross-provider tool IDs.

Notebook state management now exposes a compact help-first tool. Startup and failed recovery errors point to its action guidance.

History and notes compose inside Code and Notebook execution with Local, Tree or Remote storage. Remote searches and note text use `context_input` handles, and `wait` delivers protected results to the model. JavaScript receives receipts rather than Remote contents. Context rollover remains native.

Protected results stay bound to their original context family and Codex account. Replaying a completed delivery does not count as a new note checkpoint.
