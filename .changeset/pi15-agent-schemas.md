---
"@howaboua/pi-shepherdr": patch
---

Requires Pi 1.5 or newer.

Update and restart controllers and workers together for shared Notes and boards.

- `spawn` and `assign` now return after task submission by default. Set `blocking: true` to wait for the result. A profile's `blocking` setting still overrides `spawn`.
- Agent references now use Pi session IDs across delegation, Notes and boards. Spawn returns one `agent` reference and sharing flags instead of separate context and board references.
- Attached Notes reads keep alias paths and read-only warnings consistent across native, Code and Notebook results.
- Rollover briefings now retain initial scope and the latest instruction without accumulating every message. Full messages remain in session history.
- Fixed repeated writes of unchanged agent snapshots.
- Closed workers no longer trigger a misleading notices-unavailable reconnect warning.
- Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
