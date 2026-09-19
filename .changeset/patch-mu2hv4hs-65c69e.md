---
"@howaboua/pi-codex-conversion": patch
---

Added persistent event hooks to pinned Notebook functions.

- Run handlers automatically after Notebook tool calls with their input and outcome, without another model call.
- Initialize each fresh kernel with a startup hook; unpin remains available if startup fails.
