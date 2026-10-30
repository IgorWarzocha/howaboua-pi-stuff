---
"@howaboua/pi-gippity-control": patch
---

- Added Realtime 2.1 and Realtime 2.1 Mini, with model-specific voices in terminal and LAN settings. Codex Live remains the default.
- Added Pi API provider selection for Realtime, using the selected provider's credentials and endpoint.
- Realtime voice supports Pi tasks, extension-provided voice tools and optional Web Run search.
- Added model and reasoning settings for preparing Codex Live tasks from the voice conversation.
- Voice tasks now run as ordinary Pi requests, with live progress sent back to the call.
- Voice calls now finish the requested answer and farewell before closing. Accepted Pi tasks continue independently.
- Fixed cached Voice Context summaries not appearing at call startup.
- Fixed reasoning-summary forwarding skipping summaries when the same message also contained visible text.
- LAN voice transfers now wait for speech to finish and reconnect automatically at the same browser address on the same machine.
- Added automatic recovery from interrupted LAN voice connections, retaining the microphone where possible.
- Added `/gippity server connect` to start voice in a local or configured remote browser and report whether it is listening.
- Added `/gippity server status` and `ensure` to inspect or start the LAN listener without toggling it.
