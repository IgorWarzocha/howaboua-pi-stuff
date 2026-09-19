---
"@howaboua/pi-codex-conversion": patch
---

Preserve prompt and tool state across transcript-native Pi turns, compaction, and session replay.

- Apply structured prompt and tool updates without replacing the conversation prefix, including Code and Notebook loadout changes.
- Preserve Responses and Responses Lite grammar calls, developer messages, and native compaction checkpoints across replay and model switches.
- Prewarm the fully prepared request and retain that exact prefix for idle cache keepalive, after every extension has contributed its instructions and tools.
- Run idle developer messages, voice delegations, and voice setup through the complete prompt-preparation chain.
