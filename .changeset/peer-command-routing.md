---
"@howaboua/pi-shepherdr": patch
---

Custom extension commands sent through `agents` now require an allowlist in the receiving session's global `pi-shepherdr.json`. Update and reload Shepherdr in both controllers and receiving agents.

- Added built-in routes for `/quit`, `/model`, `/thinking`, `/name`, `/new`, `/reload`, `/resume`, and `/compact`. `/quit` shuts down Pi before closing its pane.
- Blocked commands now return available commands instead of becoming model prompts. Skills and prompt templates remain supported.
- Added command configuration guidance and the config path to Settings.
