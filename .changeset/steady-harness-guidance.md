---
"@howaboua/pi-skill-harness-and-agent-engineering": patch
---

- Updated session diagnosis and prompt-cache guidance to verify the live session, trace the first cache miss, and distinguish cache hits from continuation and prewarm.
- Updated extension design guidance on when to add tools and how to measure startup cost without sacrificing task success.
- Tool design now requires signalling failures through the host's error mechanism.
