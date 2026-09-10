---
"@howaboua/pi-codex-conversion": patch
---

Streamed realtime replies now return their final text to the requesting delegation instead of leaving the entire answer in general session context.

- Context-window rollover now requests a brief spoken acknowledgement before voice-context refresh, including notes-only mode.
- Session diagnostics retain voice call, transcript and delegation identities with text hashes to distinguish event replay from fresh recognition.
