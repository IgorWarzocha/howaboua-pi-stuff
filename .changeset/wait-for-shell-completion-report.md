---
"@howaboua/pi-codex-conversion": patch
---

- Shell guidance now directs agents to resume on the completion report instead of polling with empty `write_stdin` calls.
- Persistent execution guidance now recommends block-scoped one-off work and distinct names for retained bindings. Redeclaration errors now suggest using a block or a different name.
