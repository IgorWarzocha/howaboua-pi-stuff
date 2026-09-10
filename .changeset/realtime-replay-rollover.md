---
"@howaboua/pi-codex-conversion": patch
---

Realtime voice now rejects replayed input events and repeated delegation without fresh user input.

- Explicit Hybrid context rollover now requests a brief spoken acknowledgement before compaction.
- Session diagnostics retain voice call, transcript and delegation identities with text hashes to distinguish event replay from fresh recognition.
