---
"@howaboua/pi-shepherdr": patch
---

Shepherdr messages now respect Codex Conversion's saved-Notes idle rollover before waking an idle agent.

- Incoming messages and worker reports survive rollover and failed startup. Active agents still receive steering immediately.
- Messaging guidance limits sends to needed answers or changes to the recipient's current work. Workers are told to finish with one reply, not duplicate it with a separate message.
