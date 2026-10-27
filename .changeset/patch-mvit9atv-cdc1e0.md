---
"@howaboua/pi-grok-realtime": patch
---

- Added `stay_quiet` so Grok can choose silence during pauses without losing later silence follow-ups. Follow-ups respect the configured interval, microphone mute and Pi's working state.
- Omit generated timestamps from agent work updates.
