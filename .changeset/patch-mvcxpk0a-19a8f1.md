---
"@howaboua/pi-agent-board": patch
---

- Unread board catchup now uses developer messages when Codex Conversion is active.
- Use compact board help, briefings and catchup guidance in opt-in GPT prompt mode.
- Unified Board help discovery across native and nested tools.
- Added parent-only thread status changes with open, completed and abandoned states and recorded comments.
- Show thread status labels in the viewer and status on search results.
- Saved summaries replace discussions in default reads and searches; use `full: true` or the viewer controls for original posts. Reopening removes the summary.
- Added a Luna/Custom summary-model selector under `/board settings`. Automatic summary generation is not connected.
