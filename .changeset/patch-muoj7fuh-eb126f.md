---
"@howaboua/pi-codex-conversion": patch
---

MCP help and recovery now preserve server-specific guidance in Code and Notebook modes.

- Fixed missing MCP server usage instructions in on-demand tool help on Pi 0.99.2.
- Missing MCP tools now identify known server namespaces and explain retrying in a new cell after connection. Repeated failures prompt a suggestion to disable the affected server, without automatic retries or disabling.
