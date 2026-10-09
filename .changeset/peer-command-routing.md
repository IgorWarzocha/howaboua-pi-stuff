---
"@howaboua/pi-shepherdr": patch
---

**BREAKING CHANGE:** Custom extension commands sent through `agents` now require an `extensionCommands` allowlist in the receiving session's global `pi-shepherdr.json`. Add the commands you use, then update and reload Shepherdr in both controllers and receiving agents. `/herdr` Settings shows the config path and format.

- Added built-in routes for `/quit`, `/model`, `/thinking`, `/name`, `/new`, `/reload`, `/resume`, and `/compact`. `/quit` shuts down Pi before closing its pane.
- Blocked commands now return available commands instead of becoming model prompts. Skills and prompt templates remain supported.
- Added command configuration guidance and the config path to Settings.
