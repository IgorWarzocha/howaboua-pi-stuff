---
"@howaboua/pi-codex-conversion": patch
---

- Hotfix: Shell guidance now directs agents to resume on the completion report instead of polling with empty `write_stdin` calls.
- Hotfix: Persistent execution guidance now directs agents to scope one-off work to blocks and use distinct names for retained bindings. Redeclaration errors now suggest using a block or a different name.
