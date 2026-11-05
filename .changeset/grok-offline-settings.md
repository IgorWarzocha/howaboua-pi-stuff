---
"@howaboua/pi-grok-realtime": patch
---

Requires Pi 1.5 or newer.

- Added host-side voice settings without starting Pi or a call.
- Herdr Disconnect now shuts down the LAN listener after stopping the call.
- Reduced mid-word playback cutouts. Initial playback buffers about 500 ms plus one device callback, and quiet pauses can grow by up to 500 ms.
- Recoverable audio-device underruns and overruns no longer end calls.
- Added bounded playback and device-recovery diagnostics without recording audio.
- Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
