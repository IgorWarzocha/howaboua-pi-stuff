---
"@howaboua/pi-codex-conversion": patch
---

Reduced repetitive agent instructions and improved context handoffs.

- Notes-only `/compact` opens a new context window without a checkpoint turn when the completed run saved notes before later tool work. Context reminders reuse those notes.
- Code and Notebook prompts group execution, editing, Notebook state and customization guidance, order bundled tools by use, and leave continuation and memory-warning reminders in tool results.
- Structured prompts and tool schemas use shorter wording, with execution-resume guidance in running-command results.
- All execution modes identify Pi as the host and Codex-native tools as the toolkit.
- Bundled reviewer prompts ask for concrete findings without issue-count targets.
