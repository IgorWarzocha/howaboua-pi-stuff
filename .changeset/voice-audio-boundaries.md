---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-gippity-control": patch
---

Realtime voice now isolates muted capture and clears interrupted playback.

- Native voice cancels echo and reduces background noise.
- Spoken interruptions clear buffered audio in native and LAN playback.
- Microphone failures are reported instead of leaving a silent session.
