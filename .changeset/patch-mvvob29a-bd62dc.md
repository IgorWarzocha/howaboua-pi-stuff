---
"@howaboua/pi-notes-compaction": patch
---

- Model roles are now agent-operated. Configure them in `model-roles.json`. `/roles` is read-only, and the old `enabled` flag and accept/dismiss controls no longer apply.
- Added `new_context({role})` to continue the next context window on a role's configured model and reasoning after saving a checkpoint.
- Agents receive role names, descriptions and guidance to switch only for sustained scope changes, with subagents considered for bounded specialist work.
