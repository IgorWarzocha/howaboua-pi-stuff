# Pi Pulses

Saved routines for your main Pi agent: research, monitoring, reports, administration or any other task you define. Run a routine on demand or give it a heartbeat-style schedule. A separate worker does the work while your main agent remains available.

For example, a pulse can check for new repository issues every five hours, put its findings in an available destination and send the main agent a brief completion message with a pointer to the results.

This is a private, source-only extension. It is not published to npm or included in the aggregate packages. It runs inside Pi TUI, not Pi Durable.

## Run from a checkout

Requires Pi 1.3 or newer and a compatible worker runner. Shepherdr is the first implementation and requires Herdr. Install both packages from this checkout and restart Pi:

```sh
pi install /path/to/howaboua-pi-stuff/packages/pi-shepherdr
pi install /path/to/howaboua-pi-stuff/packages/pi-pulses
```

Shepherdr launches workers in separate Pi processes and panes, reuses their conversations and restores saved workers when their panes have closed. It injects completion reports back into the main agent through its normal waking delivery. Pulses does not duplicate those worker controls.

Other extensions can implement the [runner contract](integration.ts). The intended fit is a detached worker whose launcher owns delivery back to the main agent. Blocking the main session until a routine finishes defeats the purpose. Pulses has no fallback that executes the task inside the main agent.

## Define a routine

Create `.pi/pulses/check-new-issues.md` in your workspace:

```markdown
---
schedule: every 5h
quietHours: 22:00-08:00
---
Check for new or materially updated issues in this repository.
Use previous runs in this conversation to avoid repeating findings.
Post relevant changes and recommended next actions to the available team board.
Do not comment on or change issues, or edit repository files.
```

Use a self-explanatory filename and short procedure. The task defines its permitted actions and where results belong. Workers start in the normal workspace. Pulses does not create worktrees, require journals or implement destination-specific routing.

Run `/pulses` to see definition paths, or `/pulses check-new-issues` to run one immediately. Agents have the same small surface:

- `pulses({})` shows paths and run syntax.
- `pulses({run: "check-new-issues"})` runs a known routine.
- `pulses({skill: true})` loads the authoring instructions.

Create, edit and remove definitions with ordinary file tools. Set `enabled: false` to pause automatic scheduling while retaining the routine for explicit runs. Remove definitions you no longer need.

Schedules support `manual`, `every 30m`, `every 5h`, `every 2d`, `daily 09:00`, `weekly fri 17:00` and `at <datetime>`. Daily and weekly times use the host's local timezone. Schedule checks run every five minutes. Quiet hours hold automatic runs. Explicit runs bypass quiet hours without shifting the recurrence schedule.

## Scheduling and continuity

The first eligible main session to discover a routine owns its scheduling. Other sessions do not take it over, and pulse workers cannot become schedulers. An admitted run prevents overlapping runs of the same routine.

Scheduling requires the main Pi session to remain open. Closing it stops the scheduler, though an existing worker may continue independently. Orderly shutdown releases settled ownership. Unresolved work retains its owner, so resume that main session after an interrupted run. Pulses does not replay a backlog of missed runs.

In Git, definitions come from the original repository even when Pi starts in a linked worktree. Runtime records live in the common Git directory. Outside Git, definitions belong to the session's working directory and records live in `.pi/pulses/.runtime/`. Exclude that runtime directory from any file synchronisation or versioning intended only for definitions.

Worker history and user files are preserved. If a launch cannot be confirmed, further runs remain blocked rather than risk duplicate work. Use your runner's existing agent tools to inspect workers. Pulses does not provide a second worker-management interface.

If no launch receipt was saved, inspection alone cannot clear the block. Check the worker and task destination to establish what happened and ensure the work is no longer active. Then close the owning main session and remove only the `running` field from that routine's `state.json`. In Git this is `<common-git-directory>/pi-pulses/<name>/state.json`; elsewhere it is `.pi/pulses/.runtime/<name>/state.json`. Preserve the other fields and history, then resume the same main session. Do not clear an uncertain run merely to retry it.

## Results and context

Workers use appropriate available tools or destinations for substantive results and logs. Their final message briefly confirms completion and points to the outcome without repeating it. Failures, ambiguities and suggested procedure improvements belong separately in that final message, not in task logs or boards. Workers must not edit their definitions unless the procedure explicitly authorises it.

Completion deliberately wakes the main agent. With a non-waking report, a user could compact immediately after it arrives, letting ordinary summarisation muddle findings before the main agent processes them. Passive history alone does not provide the same opportunity to act on a result. Waking delivery is not a guarantee against simultaneous manual compaction.

PCC or Notes Compaction's idle rollover can complement this workflow by carrying working notes into a fresh window after a long idle period. That can reduce context cost when an old prompt cache has expired, but savings are not guaranteed. Neither extension is required, and Pulses does not change rollover settings.
