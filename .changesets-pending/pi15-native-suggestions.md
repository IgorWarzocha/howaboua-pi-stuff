---
"@howaboua/pi-suggestions": patch
---

Requires Pi 1.5 or newer.

- Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
- Show suggestions in empty editors with a decorated prompt prefix, including `pi-powerline-footer`.
- Add an off-by-default option to use the current chat model when the suggestion model is unavailable or its request fails, with cost and latency warnings.
