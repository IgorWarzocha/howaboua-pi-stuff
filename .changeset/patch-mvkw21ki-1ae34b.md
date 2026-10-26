---
"@howaboua/pi-shepherdr": patch
---

- **BREAKING CHANGE:** Optional integrations now require Notes 0.0.10 or newer for shared notes and history, and PCC 4.0.5 or newer for native parent linkage and cache affinity. The agents API is unchanged. Ordinary agent management requires neither extension.
- Agent guidance now directs finished workers to close without acknowledgement or shutdown messages.
- Attached note reads keep private routing details out of results while preserving read-only and stale-checkpoint warnings. Attachment acknowledgements omit internal bookkeeping.
