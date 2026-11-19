---

name: pulses
description: "Read before creating or changing a saved pulse routine."
---

Create `.pi/pulses/<lowercase-kebab-case-name>.md` in the original Git repository root (not a linked worktree), or in the main session's working directory outside Git.

```markdown
---

schedule: every 5h
enabled: true
quietHours: 22:00-08:00
---

Check the agreed sources for changes since the previous run.
Post actionable findings to the designated available destination.
```

`schedule` REQUIRED: `manual`, `every 30m`, `every 5h`, `every 2d`, `daily 09:00`, `weekly fri 17:00` or `at <datetime>`. Give one-time timestamps an explicit offset when timezone matters. Daily and weekly times and `quietHours` use the host's local timezone. Checks run every five minutes.

`enabled: false` pauses automatic runs (default: enabled). Optional `quietHours` uses `HH:MM-HH:MM`, including overnight ranges. Optional `title` overrides the display name.

Keep the body a short SOP: task, sources, available destinations and consequential limits. Include only skills the task needs. Pulses adds result-routing and procedural-feedback instructions automatically.

Edit definitions with ordinary file tools. Disable routines worth keeping; delete obsolete ones. `pulses({})` lists paths and flags invalid definitions. `pulses({run: "name"})` uses the filename without `.md` to run immediately, ignoring `enabled` and `quietHours` without changing recurrence.
