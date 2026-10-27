---
"@howaboua/pi-notes-compaction": patch
---

- Fixed native SQLite addon crashes when saving notes or searching ranked history in standalone Bun-based Pi builds. Existing notes and history indexes remain compatible with Node-based Pi.
- Fixed the session auto-pruning submenu losing its frame and disappearing during pruning. Preview, confirmation and progress now stay inside the menu.
