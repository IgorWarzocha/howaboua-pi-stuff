---
"@howaboua/pi-codex-conversion": major
---

- Replaced JS Notebook with QuickJS Code. Existing `js` settings now run fresh JavaScript per call, with up to four concurrent cells. Notebook checkpoints, profiles and project-shared variables are no longer available in this mode. Existing saved files remain untouched but are not loaded.
- QuickJS Code retains conversation-local JSON through `store` and `load` without disk persistence.
- Exact patch success acknowledgements now use `OK`. Incomplete-change warnings remain unchanged.
