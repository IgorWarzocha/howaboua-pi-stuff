---
"@howaboua/pi-browser": patch
---

Added session-owned background browser work and direct form controls.

- Fill or clear fields, select options, and set checkbox states, including indeterminate checkboxes.
- Press keys and shortcuts on the focused element.
- Wait for an element, page text, or URL with cancellation and a bounded timeout.
- Page snapshots now report checked, selected, expanded, and disabled states.
- New tabs open in the background and keep rendering during control. Show them explicitly, list session-owned tabs, and close any tab by reference.
- Tab ownership survives reloads, worker restarts, and visits to hidden browser pages. Old ownership records expire after 30 days of inactivity. Concurrent Pi sessions keep separate element references.
