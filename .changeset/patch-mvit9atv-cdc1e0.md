---
"@howaboua/pi-grok-realtime": patch
---

- **BREAKING CHANGE:** `stay_quiet` is now reserved. Rename any local voice tool using that name.
- Grok can now choose silence during pauses without losing later silence follow-ups. Follow-ups respect the configured interval, microphone mute and Pi's working state.
- Omit generated timestamps from agent work updates.
