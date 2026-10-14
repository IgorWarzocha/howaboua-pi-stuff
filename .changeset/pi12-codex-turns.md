---
"@howaboua/pi-codex-conversion": major
---

Requires Pi 1.2.0 or newer. Removed the `tryStartCodexPreparedIdleKickoff`, `tryStartCodexPreparedIdlePrompt` and `updateCodexPreparedIdleKickoff` exports. Extensions should start turns through Pi's message APIs.

- Extension-triggered turns now use Pi's full preparation without synthetic user prompts, including context-window continuations and voice requests.
- Code and Notebook now wait for MCP servers named in an exec cell before capturing its tools. `ALL_TOOLS` waits for all enabled servers.
- Fixed concurrent exec, wait and notebook calls colliding with the active Notebook kernel. Outer calls now run sequentially; tool calls within a cell can still run in parallel.
- PCC now resumes its own continuity settings when Notes Compaction is inactive for the selected model, without bringing retired conversation back into context.
