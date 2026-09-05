---
"@howaboua/pi-codex-conversion": patch
---

Added backend-authorized Luna Reserve fallback after Codex quota exhaustion.

- Show Reserve as a separate, limited allowance in `/codex usage`.
- Switch to Luna Reserve and ask the user to continue, without automatic retries or reset-credit redemption.
- Restore the original model and reasoning level when ordinary usage recovers, including resumed sessions.
