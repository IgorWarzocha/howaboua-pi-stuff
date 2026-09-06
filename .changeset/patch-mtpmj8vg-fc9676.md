---
"@howaboua/pi-codex-conversion": patch
---

Keep compaction checkpoints alongside notes with a Hybrid toggle for Local, Tree and Remote context management.

- Use Responses V2 where supported and Pi summaries elsewhere; preserve Tree checkpoints and their exact replay tails across archival.
- Request a notes checkpoint after completed tool turns before the configured compaction reserve, including after final replies.
- Make notes-only `/compact` request a checkpoint and immediate rollover instead of cutting context; reuse notes just saved for the current state.
- Give non-Astra models explicit notes and recovery guidance in every context-management mode.
- Keep deferred ideas and unrelated tasks in notes for later resumption without treating them as permission to implement.
- Apply concise follow-through guidance to all models, including heavy system-prompt rewrite.
- Keep reasoning-level bookkeeping out of Pi's default tree view while preserving model updates and replay.
