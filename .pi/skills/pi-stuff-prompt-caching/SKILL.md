---
name: pi-stuff-prompt-caching
description: "Read after general prompt-caching guidance when investigating or changing this repo's Codex cache, continuation, prewarm, replay, or compaction."
---

Discover and load an applicable general prompt caching skill before cache-sensitive work.

Run live Codex cache experiments over WebSockets with PCC's current request construction and connection lifecycle. Verify the actual transport and report fallback separately. Use SSE only for explicit SSE or fallback investigations, never as a substitute for WebSocket evidence.

For a reported miss or suspicious model, prewarm, keepalive, replay, or compaction transition, also load an applicable agent-session diagnostics skill and read `references/cache-investigation.md`.

Read `references/codex-pi-map.md` before changing conversion routing, request construction, Code Mode, continuation, prewarm, compaction, or another extension that changes the system prompt, active tools, provider-visible history, model, or reasoning lane.

Use the map to find current owners, then inspect the source and final provider request. The map is not a frozen behavior claim.
