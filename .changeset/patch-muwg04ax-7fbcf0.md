---
"@howaboua/pi-codex-guardian": patch
---

Initial release of Codex Guardian approval reviews for Pi.

- Reviews exact pending actions in native Pi, Code Mode and Notebook Mode through the active Codex provider.
- Matches explicit tool names and optional argument regexes from global and trusted repo JSON rules. Matching calls request review or block locally. Unmatched calls pass through, including wrappers whose nested calls are matched independently.
- Blocks denied, incomplete, timed-out or stale reviews before execution. Reviews require a current ChatGPT-backed Codex parent response; local block rules do not.
- Identifies reviewer requests as Codex Guardian with isolated review-session metadata and genuine parent linkage.
- Adds `/guardian` for session-scoped control and review status. Installation is separate from the extension bundles. Free billing is not established.
