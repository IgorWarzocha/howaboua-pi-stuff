---
"@howaboua/pi-codex-guardian": patch
---

Initial release of Codex Guardian approval reviews for Pi.

- Reviews exact pending actions in native Pi, Code Mode and Notebook Mode through the active Codex provider.
- Ships a configurable review scope for execution, file changes, read-only operations and other tools. Global and trusted repo JSON settings apply to ordinary and nested calls.
- Blocks denied, incomplete, timed-out or stale reviews before execution. Requires a current ChatGPT-backed Codex parent response.
- Adds `/guardian` for session-scoped control and review status. Installation is separate from the extension bundles. Free billing is not established.
