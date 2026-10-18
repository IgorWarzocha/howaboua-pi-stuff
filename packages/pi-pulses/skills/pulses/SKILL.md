---
name: pulses
description: "Read before creating or changing a saved pulse routine."
---
Create `.pi/pulses/<self-explanatory-name>.md` with a lowercase kebab-case filename. In Git, use the original repository root, not a linked worktree. Otherwise use the main session's working directory.

```markdown
---
schedule: every 5h
enabled: true
quietHours: 22:00-08:00
---
Check the agreed sources for changes since the previous run.
Post actionable findings to the designated available destination.
```

`schedule` is required: `manual`, `every 30m`, `every 5h`, `every 2d`, `daily 09:00`, `weekly fri 17:00` or `at <datetime>`. Use an explicit timezone offset for a one-time timestamp when timezone matters. Daily and weekly times and `quietHours` use the host's local timezone. Checks run every five minutes.

`enabled` defaults to `true`. Set it to `false` to pause automatic runs while keeping explicit runs available. `quietHours` is optional and accepts `HH:MM-HH:MM`, including overnight ranges. Optional `title` replaces the filename as the display title.

Keep the body a short SOP: the actual task, sources, destination and consequential limits. Do not duplicate general skill guidance or require loading skills that the task does not need. Define concrete destinations only when available. The worker receives the body plus standard result-routing and procedural-feedback instructions, so do not repeat those instructions in each definition.

Use ordinary file tools to edit definitions. Disable routines worth keeping for later; delete obsolete ones. There is no separate configuration API. `pulses({})` lists paths and flags invalid definitions. `pulses({run: "name"})` requests an immediate run, including when automatic scheduling is disabled. Explicit runs bypass quiet hours and leave the recurrence schedule unchanged.
