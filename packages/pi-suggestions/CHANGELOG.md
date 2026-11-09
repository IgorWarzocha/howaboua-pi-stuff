# @howaboua/pi-suggestions

## 0.0.3

- Requires Pi 1.5 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Fixed ghost suggestions in empty editors with decorated prompt prefixes, including `pi-powerline-footer`.
  - Added an off-by-default chat model fallback for unavailable or failed suggestion models.

## 0.0.2

- Added editable Markdown instructions in /suggestions, with defaults favouring productive next actions and avoiding repeated requests or completed work.

## 0.0.1

- Add opt-in next-step suggestions for human terminal sessions, with editable inline drafts and /suggestions model, reasoning and on/off settings. Private prediction history reuses provider caching within each chat context window.
