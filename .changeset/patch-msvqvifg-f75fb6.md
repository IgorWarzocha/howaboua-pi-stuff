---
"@howaboua/pi-subagent-review": patch
---

Preserve the review findings UI while restoring normal turn hooks for verification and disposition.

- Keep findings custom-rendered, then use a normal user turn so turn hooks run before verification and disposition.
- End cleanly without a disposition turn when the reviewer finds no actionable issues.
- Show this package’s unseen release notes in the shared startup card, with a global suppression setting.
