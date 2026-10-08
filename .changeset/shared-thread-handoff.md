---
"@howaboua/pi-shepherdr": patch
---

Pass an existing shared-board thread to a spawned agent with `board_thread_id` so its initial task includes a reference to read that context.
