---
"@howaboua/pi-codex-conversion": patch
---

- Fixed Realtime voice resubmitting Pi tasks from progress updates without new user speech.
- Fixed generated task text appearing as user speech.
- LAN Stop now waits for the voice call and pending task preparation to stop.
- Herdr Disconnect now shuts down the selected LAN listener after stopping the call.
- Read and save global voice settings from the host without starting Pi or a voice call.
- Fixed Pi 1.5 compatibility for Notebook, automatic reasoning and custom voice tools.
