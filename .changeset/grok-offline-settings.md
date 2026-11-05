---
"@howaboua/pi-grok-realtime": patch
---

Requires Pi 1.5 or newer.

- Extension updates now use Pi's native changelog notices and `collapseChangelog` setting. Custom suppression is removed.
- Read and save global voice settings from the host without starting Pi or a voice call.
- Herdr Disconnect now shuts down the LAN listener after stopping the call.
- Local speaker playback now buffers brief delivery gaps to reduce clicks, including Herdr audio.
- Audio device underruns and overruns no longer terminate the call when the device backend can recover.
- Removed cosmetic punctuation from built-in voice and continuity instructions.
