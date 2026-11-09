---
"@howaboua/pi-suggestions": patch
---

Requires Pi 1.5 or newer.

- Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
- Fixed ghost suggestions in empty editors with decorated prompt prefixes, including `pi-powerline-footer`.
- Added an off-by-default chat model fallback for unavailable or failed suggestion models.
