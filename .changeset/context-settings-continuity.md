---
"@howaboua/pi-codex-conversion": patch
---

Context settings now separate continuity, history storage and compaction method.

- Added Pi summary, Codex V2 and Both method choices independent of Local, Tree or Remote storage.
- Legacy settings migrate without replacing independent inherited choices in project configuration.
- Pi and Both summaries preserve authoritative Tree checkpoints instead of summarizing archive search text.
- Explicit notes-only rollovers retire earlier context, including archived Tree history.
- Method changes keep opaque checkpoints until conversion, never replay retired checkpoints, and refresh transport when the V2 feature requirement changes.
