---
"@howaboua/pi-notes-compaction": patch
---

Requires Pi 1.5 or newer.

- Notes results in Pi's built-in codemode are now objects, matching Code and Notebook. Remove `JSON.parse` around those results.
- History now treats a query without an action as a search.
- History now ignores `offset_chars` outside read requests.
- History now includes the initial user request when searching the first context window.
- Extension updates now use Pi's native changelog notices and `collapseChangelog` setting. Custom suppression is removed.
- Expansion hints now use your configured keybinding.
- Fix successful large note saves being rejected before a new context window or manual compaction.
- Tell agents which configured role matches their current model and reasoning settings.
- Agent guidance now names Notes actions and distinguishes virtual storage from project files.
- Notes results no longer repeat tool-usage instructions.
- On-demand Notes help now identifies read and write result fields.
- `new_context` now offers only configured role IDs.
- Notes now accepts `address` as an alias for `path`.
- Notes now accepts `body` as an alias for `text` on write and append.
