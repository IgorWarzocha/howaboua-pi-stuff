---
"@howaboua/pi-agent-comms": patch
---

- Fixed idle rollover to continue in the current window when no eligible saved checkpoint exists, including for custom deliveries.
- In Notes-only mode with the rollover tail and task-completion rollover off, a Codex prefix change can start a new window from a fresh checkpoint. The current input, attachments, and queued messages stay intact; a failed request leaves the old window open.
- Board help now states that thread replies and post search results are newest first.
