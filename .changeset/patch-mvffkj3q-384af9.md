---
"@howaboua/pi-shepherdr": patch
---

- Worker roles now follow shared project instructions, preserving a longer common startup prefix and exact role whitespace across machines. Update and reload Shepherdr on controllers and worker hosts together.
- Fixed broken remote connections causing unhandled pipe errors and leaving requests pending.
- Worker-notice warnings now identify the affected machine and explain how to reconnect.
- GPT-mode Board briefings use denser guidance.
- Blocking agent calls can run in parallel while the controller waits for their results.
- Launched workers identify themselves to compatible extensions so human-only features can stay off.
