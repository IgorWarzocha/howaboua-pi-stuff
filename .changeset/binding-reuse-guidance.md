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
- New VM Code and TS Notebook binding inventories follow the tool catalogue in model context, including after compaction.
- VM Code checks memory when it refreshes its binding inventory, including after compaction. At 90% of the memory budget, it resets an idle VM and reports that its bindings were cleared. Automatic and standalone `exec` resets preserve every value saved with `store()`.
- Code Mode results show nested tool failures even when the cell handles them. `apply_patch` guidance now requires file-ordered, non-overlapping hunks.
- Shell, Code and TS Notebook status and recovery messages are shorter. Running shell notices explain that completion reports automatically when idle and that separate status commands and log-check loops are unnecessary.
- Fixed a tool-call replay mismatch that could make GPT-6.2 drop replayed reasoning after a WebSocket reconnect. Pi's optional reasoning-drop notices now also report removals from PCC Responses streams.
- Codex compaction counts toward Pi's session totals and optional compaction cost notice. The checkpoint still explains low cache reuse.
