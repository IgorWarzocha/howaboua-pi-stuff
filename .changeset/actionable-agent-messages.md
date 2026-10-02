---
"@howaboua/pi-shepherdr": patch
---

Shepherdr messages now respect Codex Conversion's saved-Notes idle rollover before waking an idle agent.

- Incoming messages and worker reports survive rollover and failed startup. Active agents still receive steering immediately.
- Messaging guidance limits sends to needed answers or changes to the recipient's current work. Workers are told to finish with one reply, not duplicate it with a separate message.
- Orchestrators are guided to launch independent implementation workers asynchronously and end their turn when only waiting. Blocked workers are directed to a question-asking tool instead of peer messages.
