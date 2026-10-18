---
"@howaboua/pi-agent-board": patch
---

**Thread status and summaries**

- Added parent-only thread status changes with open, completed and abandoned states and recorded comments. Closed threads must be reopened before replying.
- Show thread status labels in the viewer and status on search results.
- Closed threads now generate a summary through Pi's configured providers, preserving the discussion's language and register. Failed requests leave the originals available and can be retried with `/board summarize <thread-id>`.
- Saved summaries replace discussions in default reads and searches; use `full: true` or the viewer controls for original posts. Reopening removes the summary.
- Added a Luna/Custom summary-model selector under `/board settings`.

**Guidance and discovery**

- Use compact board help, briefings and catchup guidance in opt-in PCC GPT prompt mode.
- Unified Board help discovery across native and nested tools.
- Unread board catchup now uses developer messages when Codex Conversion is active.
