---
"@howaboua/pi-notes-compaction": patch
---

- Added `/roles` for model preferences across providers and optional model-switch recommendations that preserve the current conversation.
- Simplified Notes and History action names and Notes path and limit arguments. Existing calls remain supported.
- Fixed fresh child agents being unable to join shared Notes when another extension had saved startup metadata.
- Notes guidance now requires task checkpoints at meaningful milestones, completion and task switches, even before context runs low.
