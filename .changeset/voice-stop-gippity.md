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
- Voice task preparation now treats clear conversational wrap-ups as end-call requests.
- Fixed voice playback stalling on short audio tails and bursting after delayed scheduling.
- Fixed duplicated LAN audio while waiting for speech to finish.
- Codex Live now waits for supported LAN clients to finish speaker playback before ending the call.
- Codex Live now uses available Opus repair data for missing audio packets.
- Voice playback now logs content-free packet timing, missing-packet concealment, buffering, scheduling and LAN-queue diagnostics. Herdr Voice also retains correlated connection, speaker buffering and device recovery timing without recording audio.
- Fixed generated task text appearing as user speech.
- LAN Stop now waits for the voice call and pending task preparation to stop.
- Herdr Disconnect now shuts down the selected LAN listener after stopping the call.
- Read and save global voice settings from the host without starting Pi or a voice call.
- Removed cosmetic punctuation from built-in voice instructions.
