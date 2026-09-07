---
"@howaboua/pi-shepherdr": patch
---

Deliver blocked-agent handoffs even when transcripts are unavailable.

- Reviewer spawns wait for their result before the controller continues.
- Implementation subagents are instructed to work directly rather than delegate implementation again.
- Discover and answer Pi Ask questions called inside Code and Notebook Mode.
- Retain working local and remote monitoring during connection updates, distinguish incomplete coverage from disconnection, and report recovery.
- Worker states now show their last-known status during incomplete monitoring. `/herdr connect` retries without replacing a working remote connection.
- Catch worker completions during reconnect setup and cancel obsolete or stopped monitoring connections.
