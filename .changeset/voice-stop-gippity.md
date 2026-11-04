---
"@howaboua/pi-gippity-control": patch
---

Requires Pi 1.5 or newer.

- Extension updates now use Pi's native changelog notices and `collapseChangelog` setting. Custom suppression is removed.
- Fixed Realtime voice resubmitting Pi tasks from progress updates without new user speech.
- Codex Live now ignores repeated identical handoffs within one user turn while preserving repeat requests from later turns.
- Codex Live preserves captured speech when a handoff contains only part of the request.
- Voice task preparation now explicitly forbids turning instructions into questions or adding unrequested conversational next steps.
- Voice task preparation now preserves the user's tone, register and emphasis.
- Fixed voice playback stalling on short audio tails and bursting after delayed scheduling.
- Voice playback now records content-free buffering, interruption and LAN-drop diagnostics.
- Fixed generated task text appearing as user speech.
- LAN Stop now waits for the voice call and pending task preparation to stop.
- Herdr Disconnect now shuts down the selected LAN listener after stopping the call.
- Read and save global voice settings from the host without starting Pi or a voice call.
- Removed cosmetic punctuation from built-in voice instructions.
