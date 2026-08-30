---
"@howaboua/pi-ask": patch
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-shepherdr2": patch
---

Let Pi extensions expose existing and session-gated tools inside Code and Notebook Mode.

- Pi Ask now works from cells.
- Per-call blocking lets one bridged tool offer both blocking and asynchronous operations.
- Shepherdr 2 combines persistent Herdr agents, direct blocking results and pushed asynchronous settlement in normal Pi, Code Mode and Notebook Mode. It keeps steered replies attached to the submitted message, releases blocked callers when a worker closes, exposes routed live help plus Herdr's advanced skill, and toggles orchestration through non-triggering synthetic mode messages while agent work remains ordinary user messages.
- Image-bearing Code Mode histories keep native compaction on the canonical cache lane without carrying old images beyond its retained-context budget.
