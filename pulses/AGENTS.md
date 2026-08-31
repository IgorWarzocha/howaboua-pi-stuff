Pulses are ordinary workspace folders for manual or scheduled background work.

Each Pulse lives in `pulses/<kebab-case-name>/` and contains both `PULSE.md` and `AGENTS.md`. `PULSE.md` owns the runnable responsibility, schedule, chat mode, and authority. `AGENTS.md` owns the Pulse's local habits, evidence standards, and traps. Add other files only when the work needs them.

Example `PULSE.md`:

~~~markdown
---
title: Daily issue check-up
schedule: daily 09:00
enabled: true
chat: continuous
---

Review new issues since the previous run. Triage anything actionable and finish with a natural one-to-three sentence update.
~~~

Example `AGENTS.md`:

~~~markdown
- Stay read-only unless the Pulse explicitly grants external authority.
- Keep findings beside this Pulse unless another workspace file already owns them.
- Report a quiet run plainly instead of manufacturing work.
~~~
