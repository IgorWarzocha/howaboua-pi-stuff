---
"@howaboua/pi-codex-conversion": patch
---

Context settings now separate continuity, history storage and compaction method.

- Added Pi summary, Codex V2 and Both method choices independent of Local, Tree or Remote storage.
- Context settings explain which choices preserve readable history across providers and how to convert existing V2-only checkpoints before switching.
- Legacy settings migrate without replacing independent inherited choices in project configuration.
- Pi and Both summaries preserve authoritative Tree checkpoints instead of summarizing archive search text.
- Explicit notes-only rollovers retire earlier context, including archived Tree history.
- Changing continuity or compaction method preserves usable checkpoints and the current conversation; enabling notes never starts a fresh window. Retired checkpoints stay retired, and V2 transport negotiation follows the active request.
