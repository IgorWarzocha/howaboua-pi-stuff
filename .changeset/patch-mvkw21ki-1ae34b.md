---
"@howaboua/pi-shepherdr": patch
---

- **BREAKING CHANGE:** Shared notes and history now use Notes instead of PCC. Install `@howaboua/pi-notes-compaction` and update participating hosts together to retain sharing. PCC remains optional for native parent linkage and cache affinity. Ordinary agent management requires neither extension.
- Agent guidance now directs controllers to close finished workers without preceding acknowledgement messages.
- Attached note reads keep private routing details out of results while preserving read-only and stale-checkpoint warnings. Attachment acknowledgements omit internal bookkeeping.
- GPT mode uses note-style agent help and Board briefings.
