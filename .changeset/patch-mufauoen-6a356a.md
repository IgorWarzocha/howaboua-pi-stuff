---
"@howaboua/pi-codex-conversion": patch
---

Reduced repetitive agent instructions and improved context handoffs.

- Notes-only `/compact` opens a new context window without a checkpoint turn when the completed run saved notes before later tool work. Context reminders reuse those notes.
- Code and Notebook prompts describe only the active runtime, group shell context with other guidance, and leave continuation and memory-warning reminders in tool results.
- Bundled reviewer prompts ask for concrete findings without issue-count targets.
