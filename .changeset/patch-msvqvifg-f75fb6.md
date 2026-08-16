---
"@howaboua/pi-subagent-review": patch
---

Preserve the review findings UI while restoring the `before_agent_start` lifecycle when `/review` is the first session message.

- Keep findings custom-rendered, then use a normal user turn for verification and disposition.
- Direct the agent to verify findings against the cited code, request user dispositions, and begin agreed work without resummarizing.
- End cleanly without a disposition turn when the reviewer finds no actionable issues.
- Show this package’s unseen release notes in the shared startup card, with a global suppression setting.
