---
"@howaboua/pi-grok-realtime": patch
---

- Rename any local voice tool called `stay_quiet`; this name is now reserved.
- Grok can now choose silence during pauses without losing later silence follow-ups. Follow-ups respect the configured interval, microphone mute and Pi's working state.
