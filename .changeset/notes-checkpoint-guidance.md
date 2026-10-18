---
"@howaboua/pi-notes-compaction": patch
---

**Continuity and integrations**

- Fixed Notes guidance missing from PCC's first post-compaction cache-warming request.
- With PCC active, Notes guidance uses developer-role delivery. Automatic rollover resumes from the window handoff itself, without a separate continuation message.
- Initial window identity now follows the prepared system prompt, preserving the shared prefix for child-agent caching.
- External integrations can adopt a new fork into a notes family before its first task without rewriting inherited history.

**Guidance and discovery**

- Added compact checkpoint guidance for PCC GPT prompt mode.
- Simplified Notes and History discovery, with write, path and history-ID guidance in their help.
- Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.
