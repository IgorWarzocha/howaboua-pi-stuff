---
name: scratchpad
description: "Read before creating an experimental workspace or scratchpad."
last-changed: "2026-09-11"
---

One-off probes, comparisons, captures, and check logs belong in a temporary directory. Delete them when the task finishes; do not turn validation evidence into retained reports or archives.

Use a persistent scratchpad only for a project the user explicitly wants to keep or resume. Choose a short kebab-case name:

```bash
eval "$(try-rs <name>)"
pwd
```

To start from a repository, use `try-rs <git-url> [destination]`. Do not use Try RS worktree mode.
