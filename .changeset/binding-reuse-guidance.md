---
"@howaboua/pi-codex-conversion": patch
---

- Requires Pi 1.6.1 or newer.
- Removed `yield_control()` from VM Code and TS Notebook. Use the `exec` yield timeout and `wait`. Code still supports the helper.
- VM Code lists retained bindings when a context window changes. At inventory refresh, an idle VM resets at 90% of its memory budget. Automatic and manual `exec` resets clear bindings but preserve all `store()` values.
- Fixed disabled Pi file and shell tools reappearing after reloads or model switches.
- Fixed TS Notebook startup and exact-version `npm:` imports on Windows.
- Fixed GPT-6.2 losing replayed reasoning after a WebSocket reconnect. Pi's optional reasoning-drop notices also cover Codex Conversion.
- Fixed native compaction replay in Code, VM Code and TS Notebook without Responses Lite. Codex compaction is included in Pi's session totals and optional cost notice.
- Code Mode reports failed tool calls even when the cell handles them. Shell results distinguish automatic completion notices from cases that need `write_stdin`.
- Heavy system prompt overwrite off keeps Pi's prompt with plain-language Codex guidance. On replaces it with shorter Codex instructions.
- Updated agent guidance for reusable bindings, omitting decorative backticks in arguments, ordered patch hunks and testing promising findings.
