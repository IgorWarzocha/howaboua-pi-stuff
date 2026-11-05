---
"@howaboua/pi-notes-compaction": patch
---

Requires Pi 1.5 or newer.

Older checkpoints may require a fresh note save before rollover.

- Notes results in Pi's built-in codemode are now objects, matching Code and Notebook. Remove `JSON.parse` around those results.
- Agent references now derive from Pi session IDs, with existing shared-note paths retained.
- Fixed rollover rejecting successful large saves and saves in parallel tool groups. The saved-notes indicator uses the same readiness check.
- Shared-note paths and read-only warnings now match across text and structured results.
- History now defaults query-only requests to search and includes the first window's opening request.
- History now ignores read-only hints on other actions.
- Model-role guidance now identifies the current role and offers only configured roles for rollover.
- Notes help now distinguishes virtual note paths from agent references and filesystem paths.
- Added `address` and `body` aliases for note paths and write text.
- Expansion hints now use the configured keybinding.
- Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
