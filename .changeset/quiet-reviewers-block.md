---
"@howaboua/pi-shepherdr": patch
---

Deliver blocked-agent handoffs even when transcripts are unavailable.

- Reviewer spawns wait for their result before the controller continues.
- Implementation subagents are instructed to work directly rather than delegate implementation again.
