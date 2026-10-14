---
"@howaboua/pi-notes-compaction": patch
---

Requires Pi 1.2.0 or newer. Context-window continuations now use fully prepared extension turns without synthetic user prompts. Idle extension requests preserve fresh-notes rollover.

Added **Active: All models | Whitelist** to `/notes`, with an editable provider-independent model whitelist preseeded with GPT6 model IDs. Model switches apply activation immediately.
