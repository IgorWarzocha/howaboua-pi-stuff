---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-gippity-control": patch
"@howaboua/pi-codex-conversion": patch
---

Added `agents focus` for running Pi sessions, with optional voice transfer through GipPity Control or Codex Conversion.

- Keep the existing microphone and browser connection while continuing with the destination's context.
- Include attributed handoff context and a return action without starting an agent task.

Remote focus selects the destination's Herdr session; client machine selection remains manual.
