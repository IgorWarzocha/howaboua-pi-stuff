# @howaboua/pi-browser

## 0.0.4

- Added session-owned background browser work and direct form controls.

  - Fill or clear fields, select options, and set checkbox states, including indeterminate checkboxes.
  - Press keys and shortcuts on the focused element.
  - Wait for an element, page text, or URL with cancellation and a bounded timeout.
  - Page snapshots now report checked, selected, expanded, and disabled states.
  - New tabs open in the background and keep rendering during control. Show them explicitly, list session-owned tabs, and close any tab by reference.
  - Tab ownership survives reloads, worker restarts, and visits to hidden browser pages. Old ownership records expire after 30 days of inactivity. Concurrent Pi sessions keep separate element references.

## 0.0.3

- Removed redundant tool guidance from Ask, Shepherdr, Skills and Browser. Code and Notebook Mode now show one callable contract per tool, with detailed Browser and agent rules in help.

## 0.0.2

- Keep tool results actionable.

  - Browser evaluation errors preserve JavaScript exception details instead of a generic “Uncaught”.
  - Skill path inventories omit installed dependencies; reference reads list only the requested sources instead of repeating the full inventory.

## 0.0.1

- Initial release of Browser, a persistent typed CDP tool for normal Pi, Code Mode, and Notebook Mode.

  - Inspect existing browser tabs, follow references, find text, click, type, capture screenshots, and use raw CDP when needed.
  - Connect to local or configured remote hosts, with aliases and worker setup managed through `/browser`.
