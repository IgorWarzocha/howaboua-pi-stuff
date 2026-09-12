---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-gippity-control": patch
"@howaboua/pi-shepherdr": patch
---

Fixed missing voice replies and noisy spoken progress updates.

- Worker updates now accept up to 8 KiB without truncation announcements or offers to read the rest.
- Reasoning-summary forwarding now recognizes GPT-6 models.
- Replies resume in voice after a context-window rollover, and carried transcripts no longer falsely report that the user ended the call.
