---
"@howaboua/pi-shepherdr": minor
---

Shepherdr now uses Herdr's native machine catalog and requires Herdr 0.9 or newer. Re-add machines through `/herdr machines`; `shepherdr.json`, old machine aliases and their saved watches are no longer used.

- Manage saved SSH profiles with native setup, rename, enable, disable and remove actions.
- Agent prompts and reports identify their source workspace, tab and pane, including current names.
- Attributed messages to running Pi Codex agents use developer steering. Idle tasks retain normal user kickoff and extension preparation.
- Agent guidance now distinguishes asynchronous peer coordination from blocking delegated work.
