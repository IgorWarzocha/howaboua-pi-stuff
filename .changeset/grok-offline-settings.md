---
"@howaboua/pi-grok-realtime": patch
---

Requires Pi 1.5 or newer.

- Extension updates now use Pi's native changelog notices and `collapseChangelog` setting. Custom suppression is removed.
- Read and save global voice settings from the host without starting Pi or a voice call.
- Herdr Disconnect now shuts down the LAN listener after stopping the call.
- Local and Herdr speaker playback rebuild their audio reserve during quiet pauses to reduce mid-word cutouts. Startup buffering is about 350 ms plus one device callback, and each quiet pause can grow by up to 80 ms. Spoken samples retain their order and speed.
- Audio device underruns and overruns no longer terminate the call when the device backend can recover.
- Herdr Voice records bounded speaker timing, buffering and device recovery diagnostics without recording audio.
- Removed cosmetic punctuation from built-in voice and continuity instructions.
