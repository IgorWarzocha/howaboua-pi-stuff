---
"@howaboua/pi-shepherdr": minor
---

Shepherdr now reads existing Herdr machine profiles and requires Herdr 0.9 or newer. Manage profiles in Herdr; `shepherdr.json`, old machine aliases and their saved watches are no longer used.

- Agent prompts and reports identify their source workspace, tab and pane, including current names.
- Attributed messages to running Pi Codex agents use developer steering. Idle tasks retain normal user kickoff and extension preparation.
- `send` delivers peer messages without blocking or subscribing; use `assign` to delegate work to an existing agent.
- Automatic task watches end on completion or failure. Only explicit `watch` subscriptions persist; legacy watches are cleared with a notice.
