---
"@howaboua/pi-codex-conversion": patch
---

Fixed notes-based `/compact` to open the new context window after the prompted note-saving run settles, without asking the agent to call `new_context` or starting a turn in the new window. A missing or failed note leaves the current window in place.
