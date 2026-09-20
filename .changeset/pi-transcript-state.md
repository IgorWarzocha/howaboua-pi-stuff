---
"@howaboua/pi-codex-conversion": patch
---

Pi 0.86.0 or newer is now required. Prompt and tool state now survives transcript-native Pi turns, compaction, and session replay.

- Apply structured prompt and tool updates without replacing the conversation prefix, including Code and Notebook loadout changes between runs.
- Preserve Responses and Responses Lite grammar calls, developer messages, and native compaction checkpoints across replay and model switches.
- Repair malformed JSON string escapes in streamed tool arguments using Pi's parser.
- Prewarm the fully prepared request and retain that exact prefix for idle cache keepalive, after every extension has contributed its instructions and tools.
- Run idle developer messages, voice delegations, and voice setup through the complete prompt-preparation chain.
- Supply Notebook startup status and retained bindings automatically instead of requiring an opening status tool call.
- Removed redundant developer-message wording and internal Notebook generation IDs. Realtime voice now explicitly requests progress between tool calls instead of silence until the final answer.
- Save `/codex` settings immediately but defer applying them until the current run settles, keeping active tools and instructions in sync. The settings UI and voice stop, mute and server controls remain immediately available.
- Report context budgets against the active model's full configured window, request a notes checkpoint at 85% used, and send an urgent reminder at 90% without forcing rollover.
- Compact on overflow instead of cutting to a fresh window, even with Hybrid off. Preserve the checkpoint and recent conversation in the current window.
- Added opt-in current time reminders at 30 or 60 minute intervals during active inference, without changing the system prompt or starting extra turns.
- Include structured prompt updates in Local and Tree history searches.
- Avoid an unnecessary checkpoint model turn after tree navigation back to the final reply of a run that just saved notes.
- Prevent Pi's generic cache warmer from generating uncapped responses or disturbing continuation on Codex and Responses Lite routes; retain isolated Codex keepalive.
