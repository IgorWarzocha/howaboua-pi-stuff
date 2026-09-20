---
"@howaboua/pi-codex-conversion": patch
---

Pi 0.86.0 or newer is now required. Prompt and tool state now survives transcript-native Pi turns, compaction, and session replay.

- Apply structured prompt and tool updates without replacing the conversation prefix, including Code and Notebook loadout changes between runs.
- Preserve Responses and Responses Lite grammar calls, developer messages, and native compaction checkpoints across replay and model switches.
- Repair malformed JSON string escapes in streamed tool arguments using Pi's parser.
- Prewarm the fully prepared request and retain that exact prefix for idle cache keepalive, after every extension has contributed its instructions and tools.
- Run idle developer messages, voice delegations, and voice setup through the complete prompt-preparation chain.
- Respect per-model compaction reserves in context budgets and include structured prompt updates in Local and Tree history searches.
- Avoid an unnecessary checkpoint model turn after tree navigation back to the final reply of a run that just saved notes.
- Prevent Pi's generic cache warmer from generating uncapped responses or disturbing continuation on Codex and Responses Lite routes; retain isolated Codex keepalive.
