---
"@howaboua/pi-codex-conversion": patch
---

- Removed the explicit `yield_control` helper from VM Code and TS Notebook. Use timed execution and `wait` instead. The upstream Code host still provides it.
- With Heavy system prompt overwrite off, Codex keeps Pi's prompt and adds guidance in plain prose. Turning it on replaces the stock instructions with telegraphic Codex guidance.
- Codex follows promising findings through to a practical check or reversible trial instead of stopping at recommendations.
- Code, VM Code and TS Notebook tell agents not to add decorative backticks to tool arguments. Execution mode names match the settings picker in status and error messages.
- Native compaction matches replay history using the actual request format, including Code and Notebook sessions that do not use Responses Lite.
- Pi's selected file and shell tools stay selected across reloads and model switches in every execution mode, without restoring tools the user disabled.
- Fixed Windows npm installs for TS Notebook startup and exact-version `npm:` imports.
- VM Code shows persistent binding names after context rollover. VM Code and TS Notebook require one-off declarations in a block and explain how to replace retained values without redeclaring them.
- Code Mode results show nested tool failures even when the cell handles them. `apply_patch` guidance now requires file-ordered, non-overlapping hunks.
- Shell, Code and TS Notebook status and recovery messages are shorter. Shell results explain that completion reports automatically when idle.
