---
name: pi-stuff-prompt-caching
description: "Read for changes to Pi prompt assembly, tool activation, or Codex caching, continuation, prewarm, replay and compaction."
---

Discover and load an applicable general prompt caching skill before cache-sensitive work.

Run live Codex cache experiments over WebSockets with PCC's current request construction and connection lifecycle. Verify the actual transport and report fallback separately. Use SSE only for explicit SSE or fallback investigations, never as a substitute for WebSocket evidence.

For a reported miss or suspicious model, prewarm, keepalive, replay, or compaction transition, also load an applicable agent-session diagnostics skill and read `references/cache-investigation.md`.

Read `references/codex-pi-map.md` before changing conversion routing, request construction, Code Mode, continuation, prewarm, compaction, or another extension that changes the system prompt, active tools, provider-visible history, model, or reasoning lane.

Use the map to find current owners, then inspect the source and final provider request. The map is not a frozen behavior claim.

- Keep the standing prefix small and stable. Defer nonessential tools through Code or Notebook without losing discovery. Supply nonessential guidance on demand in results or supported chronological messages.
- Tool activation updates the live catalogue and chronological notices, not the standing system prompt. Rebuild tool-derived standing guidance from current state only at session or window rollover. Never rewrite earlier tool calls or results to integrate a tool.
- Use chronological developer messages when supported and Pi custom messages otherwise. Pi's `sendMessage` custom entries become provider user messages; their purple-box presentation is not a system role. Do not use system updates for this: the unsupported-provider fallback folds them into the initial prompt.
- Trace each kickoff through the complete `before_agent_start` chain before prompt or tool rewrites and prewarm. Pi prepares user and idle custom-message starts, not in-run steering. Preparation is busy; finish tree navigation first. Do not patch captured prompts in place of running other extensions' preparation.
