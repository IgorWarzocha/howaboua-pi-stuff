---
"@howaboua/pi-shepherdr": patch
---

Requires Pi 1.5 or newer.

- `spawn` and `assign` now return after task submission by default. Set `blocking: true` to wait for the result. A profile's `blocking` setting still overrides `spawn`.
- Extension updates now use Pi's native changelog notices and `collapseChangelog` setting. Custom suppression is removed.
- Attached Notes reads preserve structured results, alias paths and read-only warnings.
- Agent guidance now uses compact tool-prefixed wording.
- Agent snapshots and rollover briefings retain initial scope and the latest instruction instead of accumulating every message. Full messages remain in session history.
- Unchanged agent snapshots are no longer written repeatedly.
