---
"@howaboua/pi-codex-conversion": patch
---

Aligns native OpenAI compaction with Codex v1 by compacting the full active transcript and preserving cached history prefixes during oversized-request trimming. Adds an opt-in Responses compaction v2 protocol that uses the active provider stream and retains recent real user messages beside the encrypted checkpoint.
