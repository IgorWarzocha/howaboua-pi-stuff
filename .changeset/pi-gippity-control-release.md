---
"@howaboua/pi-gippity-control": patch
---

### Features

- Select native microphones and speakers in settings, including system defaults and saved unavailable devices. Changes apply on the next local audio start without changing browser or handed-off audio.
- Save voice and context-summary preferences from the LAN browser for the next call without restarting the current call or changing credentials or native devices. Project settings can disable globally configured context summaries.
- Transfer voice through `agents focus`, retaining the microphone and browser connection while switching to the destination's context. Handoffs include attributed context and a return action without starting an agent task.
- Choose primary and alternate voices in terminal or browser settings. Each session transfer alternates voices and greets the user in the destination's context.

### Fixes

- Voice and dictation refuse startup while another voice provider is active in the same Pi session, including during reconnection and microphone transfer.

