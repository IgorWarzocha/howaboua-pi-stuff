# Herdr Proactive

Let an agent check in on your work or follow a schedule. Choose the agent, write its instructions and decide when it should act. Each workspace starts with automatic messages off.

Check-ins can match your activity or run at a regular interval. They learn from results you view across the workspace, with recent activity compared against up to 12 months of history. No terminal output or conversation transcripts are collected.

Automations follow their own instructions and schedule: repeat, run daily, choose weekdays or run once. Missed occurrences combine into one run. Check-ins wait for you to read previous results. Clock schedules and quiet hours use UTC. Quiet hours apply to check-ins. A timed pause stops both check-ins and their automations.

## Requirements

Use Linux or macOS with Node.js 24 or newer, `hc` and a current Herdr desktop app. SQLite comes from Node's built-in `node:sqlite` module, so no database server or extra native package is needed. Core must support layout-document reads, event subscriptions and status-guarded sends. The helper installer requires a POSIX shell. The service runs on each machine hosting its receiving agents, independently of the viewing desktop.

Recipients must report OSC 7501 status and reach the literal `idle` state. Core currently cannot atomically guard a send against `done`, so a recipient reporting only `done` waits rather than being interrupted. Details shows the reason for a wait.

**Messages are pasted into the agent and submitted. This can also submit an unfinished draft already in its editor.** Allowing messages requires explicit acknowledgement of this limitation. There is no agent-specific mailbox or draft inspection. Permission dialogs are never forced. If the agent restarts or moves, choose it again before sending more messages.

## Install

On every machine hosting proactive agents, from this repository:

```sh
cd apps/herdr-proactive
node scripts/install.mjs
herdr-proactive serve
```

Keep the checkout and the installed Node executable at their current paths. The helper is source-linked. Make `~/.local/bin` available on Core's PATH. Run `serve` under your normal process supervisor if it should survive logout. Installation does not start it or modify login services.

On the viewing desktop, with the same source available:

```sh
node apps/herdr-proactive/src/cli.mjs install-mod
```

This installs `proactive` under `${HERDR_APP_HOME:-~/.config/herdr-app}/mods`. It preserves an existing folder not owned by its installer. Updates require running the installer again. Open **Proactive** from Herdr's command palette.

For sidebar access, add this block to a personal layout. Duplicate a shipped layout before editing its structure:

```json
{ "id": "proactive", "type": "block", "size": { "px": 42 }, "content": { "mod": "proactive", "props": { "compact": true } } }
```

## First check-in

1. Focus the receiving agent, then open Proactive from the sidebar's settings icon or the command palette.
2. Select its machine and workspace. Use the plus beside **Check-ins**.
3. Write the instructions and choose the timing. **Match my activity** learns when to check in. **At a regular interval** uses your chosen frequency. **Only when asked** leaves check-ins manual while allowing scheduled automations.
4. To turn messages on, review the unfinished-draft warning, allow sending and select **Active**. Save with the checkmark. Saving without these choices leaves the check-in paused.

Use the target icon to check in now, the pause icon to stop messages or the settings icon to edit. Under **Automations**, the plus opens a separate editor for instructions and a schedule. Choose the check-in whose agent should receive it. Pausing that check-in also stops its automations.

The sidebar follows the focused workspace and folds into a small popup in rail mode, like Voice and State. Activity and connection details have their own views. File paths appear only in Details or an editor's extra options. If a file changes while you edit, your draft is kept and you can review and combine the changes before saving.

The panel refreshes after actions, on focus changes or when you click Refresh. It does not poll. The service continues listening and scheduling while the desktop is closed.

## Workspace instruction files

Each workspace owns its instructions. The native editor writes the same Markdown files that agents and ordinary editors can edit directly:

```text
your-workspace/
  .herdr/proactive/check-in/PROACTIVE.md
  pulses/review-open-work/PULSE.md
  pulses/review-open-work/AGENTS.md
  pulses/review-open-work/journal.md
```

Each check-in and automation has its own folder. Pulse-local instructions and artifacts stay alongside `PULSE.md`. Removing a check-in or automation removes its definition files, never those folders, journals or `AGENTS.md` files.

A check-in's body contains its instructions:

```markdown
---
title: Workspace check-in
scope: workspace
recipient: t1
enabled: false
mode: adaptive
minMinutes: 240
quietHours: 22:00-08:00 UTC
allowTerminalInput: false
---
Review unfinished work in this workspace.
Take a useful next step if warranted. Otherwise do nothing.
```

Replace the example recipient with the intended agent's local Core address. Enable only after reviewing the terminal-input limitation. A new enabled definition binds to its first available matching recipient. That process binding is machine-local. Replacing the process pauses work until you explicitly rebind it in the panel.

An automation's `policy` field references the check-in folder's local name. Its body is a plain Markdown SOP, not a JSON string:

```markdown
---
title: Review open work
policy: check-in
enabled: true
schedule: weekly mon,thu 09:00
timezone: UTC
---
Review the agreed issue tracker for this workspace.
Summarise actionable changes since the previous run in journal.md beside this file.
Do not change repository files or contact anyone.
```

Schedules accept `every 30m`, `every 5h`, `daily 09:00`, `weekly mon,thu 09:00` and `at 2027-01-15T09:00:00Z`. Interval definitions can include an ISO `anchor`; otherwise tracking starts when the service first observes them. Frontmatter supports flat scalar fields and comments, not general nested YAML. The body is unrestricted Markdown. Both the check-in and its automation must be enabled for scheduled work.

The service watches only its definition directories and their creation points. Saving a file reloads that workspace, without scanning other workspaces. Invalid definitions are reported by file path and do not stop healthy automations. Native saves check file revisions, preserve unrelated frontmatter and refuse conflicting edits. Saves spanning multiple definitions are individually atomic, not one multi-file transaction.

## Private runtime storage

Instructions stay in Markdown. Activity and execution bookkeeping use a separate machine-local SQLite database for each workspace:

```text
$XDG_STATE_HOME/herdr-proactive/<core-hash>/workspaces/<workspace-root-hash>/
  state.sqlite
```

`XDG_STATE_HOME` defaults to `~/.local/state`. Activity aggregates, scheduling cursors, process bindings, controls and receipts occupy relational tables, not serialized JSON objects. Updates use transactions. Daily detail, monthly history and delivery receipts are pruned to their stated limits. There is no accumulating raw activity log.

Automation bodies never enter the database. Agents author Markdown definitions, not bookkeeping rows. Workspaces pointing at the same folder share its definitions and learned history. A small per-Core `service.sqlite` stores service-process metadata. Plain change-notification markers announce committed control or state changes without polling the databases. SQLite may also create its normal WAL sidecar files while connections are open.

## Activity and recovery

An engagement is an observed advance of `herdr.seen`. Views within 15 minutes of one another coalesce into one workspace engagement. Viewing is attention, not proof that a human typed or that a result was useful. Rates use connected observation time. Offline gaps remain unknown, and reconnect snapshots never invent engagement timestamps. Adaptive timing compares recent engagement rates with historical rates and prefers previously engaged hours. With little history, it uses the configured minimum interval.

Pause and snooze stop new work from being accepted. A prompt accepted just before you pause can still arrive. Reset clears learned workspace activity. Removing a definition does not erase learned history or previous receipts. Thread scope binds to a live terminal process, not a portable native conversation session. It does not reopen agents after a reboot.

If delivery times out or the service stops mid-send, it records an uncertain attempt and pauses that check-in. Inspect the agent before acknowledging it. Acknowledgement clears the hold without retrying the old prompt. Receipts retain the last 32 attempts per check-in without prompt bodies. Connection failure stops the service visibly. Restart it to reconcile from a fresh Core snapshot.

## Validation

```sh
cd apps/herdr-proactive
npm run check
```

The check uses a disposable Core, inert terminal fixtures and a copied mod. It makes no model calls and does not change the live desktop. Native layout and interaction still need visual inspection.
