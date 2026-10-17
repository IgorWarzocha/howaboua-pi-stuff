---
"@howaboua/pi-notes-compaction": patch
---

- Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.
- Initial window identity now follows the prepared system prompt, preserving the shared prefix for child-agent caching.
- With PCC active, Notes guidance uses developer-role delivery. Automatic rollover resumes from the window handoff itself, without a separate continuation message.
- External integrations can adopt a new fork into a notes family before its first task without rewriting inherited history.
