---
"@howaboua/pi-codex-conversion": patch
---

Aligns native OpenAI compaction with Codex v1 by compacting the full active transcript and preserving cached history prefixes during oversized-request trimming. Adds an opt-in Responses compaction v2 protocol that uses the active provider stream and retains recent real user messages beside the encrypted checkpoint. Running Code Mode cells and shell commands now identify the exact continuation call needed to resume them in their active tool mode, while repeated Code Mode waits back off locally to give long-running work time to finish.
