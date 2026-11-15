---
"@howaboua/pi-notes-compaction": patch
---

Role guidance now directs each agent to choose its own preset at sustained phase changes, without waiting for approval or delegating just to switch roles.

Added opt-in task-completion rollover: `new_context({resume: false})` finishes the reply and opens fresh context without starting another turn.

Added same-cell context rollover after an awaited note save in Code and Notebook.
