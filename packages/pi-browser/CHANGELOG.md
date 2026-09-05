# @howaboua/pi-browser

## 0.0.2

- Keep tool results actionable.

  - Browser evaluation errors preserve JavaScript exception details instead of a generic “Uncaught”.
  - Skill path inventories omit installed dependencies; reference reads list only the requested sources instead of repeating the full inventory.

## 0.0.1

- Initial release of Browser, a persistent typed CDP tool for normal Pi, Code Mode, and Notebook Mode.

  - Inspect existing browser tabs, follow references, find text, click, type, capture screenshots, and use raw CDP when needed.
  - Connect to local or configured remote hosts, with aliases and worker setup managed through `/browser`.
