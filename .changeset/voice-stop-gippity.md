---
"@howaboua/pi-gippity-control": patch
---

Requires Pi 1.5 or newer.

- Fixed duplicate voice task submissions from progress updates and repeated handoffs.
- Voice task preparation now preserves captured speech, tone and instructions without adding questions or next steps.
- Voice now recognises conversational wrap-ups and waits for LAN speaker playback before ending calls.
- Fixed stalled short audio tails, playback bursts and duplicated LAN audio. Codex Live now uses Opus packet repair.
- Added content-free connection and playback diagnostics without recording audio.
- Fixed generated task text appearing as user speech.
- LAN Stop now cancels pending task preparation. Herdr Disconnect also closes the listener.
- Added host-side voice settings without starting Pi or a call.
- Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
