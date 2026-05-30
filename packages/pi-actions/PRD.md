# Pi Actions PRD

## Summary

Pi Actions is a repo-local, file-backed actions runner for Pi agents. Users define workflows in readable YAML, run them from the Pi TUI, or run them non-interactively from a terminal command that can be called by cron, systemd timers, launchd, CI, or shell scripts.

The core idea: **GitHub Actions-shaped workflows for local agent work**.

```yaml
# .pi/actions/daily-bug-scan/action.yml

version: 1

name: Daily Bug Scan

description: Look for likely regressions in recent commits.

status: scheduled

on:
  workflow_dispatch:
  schedule:
    - cron: "0 9 * * *"

jobs:
  bug_scan:
    branch: main
    mode: read-only
    session: continue

    steps:
      - name: Gather recent changes
        run: git log --since="24 hours ago" --oneline --stat

      - name: Apply bug-hunting lens
        skill: agent-native-hardening
        with:
          focus: likely regressions in recent commits
          mode: shallow

      - name: Ask agent for likely bugs
        ask: |
          Scan the recent commits above for likely bugs.
          Use concrete evidence only: SHAs, files, diffs, failing checks.
          Propose the smallest safe fix, or stay quiet.
```

## Goals

- Make workflows easy for agents and humans to write.
- Keep workflow files portable, inspectable, and versionable.
- Feel familiar to users who know GitHub Actions.
- Support manual runs from Pi TUI.
- Support non-interactive terminal runs for user-owned scheduling.
- Support bash-only, agent-only, and mixed bash/skill/agent workflows.
- Protect live working trees by running actions in action-owned worktrees or run folders, not the user's active checkout.
- Store run history/state separately from workflow definitions.

## Non-goals

- Reimplement GitHub Actions completely.
- Ship or require an always-on daemon, hosted service, or separate runner.
- Hide workflow definitions in app-owned DB state.

## Target users

- Developers who want local recurring repo checks.
- Agents creating follow-up/watchdog workflows for users.
- Users who want cron-like local agent work without another service.

## Product shape

### Package / extension

- Package name: `pi-actions`.
- User-facing name: **Actions**.
- Runs as a Pi extension with a TUI GUI.
- Exposes a non-interactive command for terminal/scheduler use.

### Filesystem

Each workflow lives in its own folder:

```txt
.pi/actions/daily-bug-scan/
  action.yml
  memory.md

.pi/actions/pr-review/
  action.yml

.pi/actions/weekly-cleanup/
  action.yml
```

Codex Desktop uses `~/.codex/automations/<id>/automation.toml + memory.md`; borrow the adjacent-memory idea where useful, but keep Pi Actions repo-local under `.pi/actions/<id>/` and YAML-first.

### Root resolution

Pi Actions stores action definitions and action-owned files only at the resolved root. When invoked inside a Git repo subfolder, the runner walks up to the Git root and loads/creates `.pi/actions/...` there. It must not create extra `.pi/actions` folders in nested subdirectories.

The invocation directory still matters: if the user started Pi from a subfolder, that origin cwd should be captured as the default action `cwd`/scope inside the root-backed action. This lets an action target `docs/` while still storing its definition and run artifacts at `<git-root>/.pi/actions/<id>/...`.

For non-Git directories, the current directory is treated as the target root unless the workflow explicitly sets `cwd`. The runner should not silently walk to broad parent folders such as home or Downloads unless that is the directory the user/action selected. If the user wants a global/home-scoped action, they can run Pi from their home directory. The UI should make target folders clear, including home/global-looking assignments.

`cwd` in the schema is the action target scope relative to the resolved root when possible. `working-directory` is only a subdirectory inside the resolved action execution workspace.

### Action ids

Action ids are folder names and must be strict slugs: lowercase letters, numbers, and dashes.

Examples:

```txt
daily-bug-scan
tidy-downloads
weekly-docs-post
```

When creating actions from UI/agent input, Pi Actions should normalize labels into slugs, e.g. `Tidy Downloads` -> `tidy-downloads`, and reject/ask only when normalization would collide or produce an empty id.

## Workflow schema

### Top-level fields

- `version`: schema version. The first schema is `1`; future changes should be backwards-compatible where possible.
- `name`: human-facing workflow title.
- `description`: optional short explanation.
- `on`: triggers.
- `status`: `manual`, `scheduled`, or `paused`.
- `jobs`: one or more jobs.

### Triggers

```yaml
status: scheduled

on:
  workflow_dispatch:
  schedule:
    - cron: "0 9 * * *"
  session_start:
  session_end:
```

Supported trigger families:

- `workflow_dispatch` for manual runs.
- `schedule` with GitHub Actions-style cron.
- `rrule` for calendar-like schedules.
- file/git events.
- session lifecycle events such as session start/end.
- external app/webhook events.

Detailed trigger semantics — debounce, claim/replay behavior, missed runs, and ordering — should be refined during implementation. The PRD keeps the trigger families broad so the product direction is visible without pretending the scheduler details are solved.

### Job fields

- `branch`: optional target branch for the workflow.
- `mode`: `read-only` or `destructive`; controls intent and review expectations, not whether a worktree is used.
- `cwd`: optional target scope for the action. Defaults to the origin cwd, stored relative to the resolved root when possible.
- `working-directory`: optional path relative to action execution root.
- `session`: `fresh` or `continue`.
- `env`: optional environment variables.
- `steps`: ordered workflow steps.

### Step types

```yaml
- run: git status --short
```

Runs a shell command. Output becomes run log and context for following agent steps.

```yaml
- ask: |
    Review the command output above.
```

Starts or continues an agent turn with accumulated context.

```yaml
- skill: agent-native-hardening
  with:
    focus: likely regressions
```

Injects/uses a named skill as a first-class step.


## Pi CLI capabilities to use

`pi --help` gives Pi Actions most of the runtime shape without a separate runner:

- `-p` / `--print` runs Pi non-interactively and exits.
- `--mode json` streams machine-readable session events for one-shot non-interactive runs.
- `--mode rpc` keeps a controllable child Pi process alive for sidecar/subagent-style runs.
- `--no-session` supports ephemeral runs that rely on markdown memory.
- `--session-dir`, `--session-id`, `--session`, `--continue`, and `--fork` support persistent continued action sessions when `session: continue` is configured.
- `--tools`, `--exclude-tools`, `--no-tools`, and `--no-builtin-tools` exist in Pi, but Pi Actions should not rely on tool gating as its main safety model.
- `--skill <path>` can load action-specific skills.
- `--append-system-prompt <text|file>` can inject action metadata and guardrails.
- Extensions can register CLI flags, so Pi Actions can expose action-specific non-interactive entrypoints through Pi itself.

Proposed extension flag shape:

```bash
pi --action daily-bug-scan --print
pi --actions-due --mode json
```

`--action` and `--actions-due` are not built-in Pi flags; Pi Actions would register them with `pi.registerFlag()`. Use JSON mode for fire-and-forget terminal runs where the parent only needs event logs. Use RPC mode for sidecar runs where the extension needs to keep a child session alive, send follow-up prompts, poll state, render live widgets, stop the child, or inject results back into the current session. `pi-smart-btw` proves this shape with `pi --mode rpc --no-session` in a child process and a child-process guard that disables the extension inside the child.

Pi extension flags with `--print` are the canonical non-interactive interface because they keep execution inside Pi and leave room for richer host/Howcode UI integration later. Pi extensions can register flags and slash commands, not new `pi actions run` subcommands. A future package-level wrapper script can provide a nicer PATH command while still calling Pi under the hood. It should remain a thin convenience shim, not a separate runner.

## Runtime behavior

### Manual run

- User selects a workflow via `/actions` or types `/action <name>`.
- Runner validates YAML.
- Runner creates a timestamped run folder/status entry where needed.
- Steps execute in order.
- Run status updates live in TUI.

### Non-interactive run

Pi Actions can run from a terminal without opening an interactive Pi session. This is the path for cron-like behavior. JSON mode is preferred here because it provides a structured event stream while still exiting when the run is done. The JSON stream is transport/logging output, not the primary stored run artifact.

Primary non-interactive command shape:

```bash
pi --action daily-bug-scan --print
pi --actions-due --mode json
```

Users own scheduling. Pi Actions should be safe to invoke repeatedly from cron, systemd timers, launchd, CI, or shell scripts. Due runs are claimed once, and missed runs after downtime are reconciled conservatively to avoid surprise catch-up storms.

### Sidecar run

Pi Actions can also run as a sidecar from an active Pi session. This is an interactive extension behavior, likely exposed through `/action <id>` or the Actions TUI, not a terminal-only `--sidecar` flag. It should mimic `pi-smart-btw` closely: run asynchronously in a child Pi process, show a compact widget while running, and write the final summary back as a display-only ignored system/custom message. No follow-ups or interactive sidecar chat for now.

This follows the `pi-smart-btw` pattern:

- spawn `pi --mode rpc` as a child process
- disable Pi Actions inside child processes to avoid nested action runners
- use `--no-session` for ephemeral action runs, or `--session-dir .pi/actions/<id>/session --session-id main` for continued action runs
- send prompts over RPC
- poll `get_state` for idle/running state
- collect `message_end`, `agent_end`, and tool events for logs/status
- stop the child explicitly when dismissed/cancelled
- send the final summary to the parent transcript as a display-only ignored system/custom message
- do not inject sidecar output into LLM context unless a later explicit user action supports that

JSON mode is still useful for logs, but RPC is the right primitive for live sidecars. Sidecar output should be visible to the user without automatically steering or polluting the parent agent context.

### Path behavior

Pi Actions should not pretend it can fully sandbox an agent by validating paths. Agents and shell commands may traverse directories; clankers do be clanking. The product relies on clear root resolution, action-owned storage, worktrees/run folders, and explicit guardrails rather than a brittle path-policing layer.

The runner must still avoid creating action definitions/artifacts in surprise locations. `cwd` and `working-directory` affect where the action runs, not where `.pi/actions/<id>/...` is stored.

### Workspace safety

Actions must declare whether they are read-only or destructive. This is not tool gating; the agent keeps its normal capabilities. The field controls where the action runs.

```yaml
jobs:
  bug_scan:
    branch: main
    mode: read-only

  apply_safe_fixes:
    branch: main
    mode: destructive
```

Git-backed actions run in an action-owned git worktree under the hidden action folder. Non-Git actions run through a timestamped output folder. Pi Actions should not run workflow steps in the user's active checkout. This avoids branch switching, dirty-tree conflicts, dependency/install side effects, and unclear historical provenance.

`read-only` means the workflow is expected to inspect/report only. `destructive` means it may produce file changes, install dependencies, create commits in Git mode, or otherwise prepare mutations in its isolated workspace. Both modes still use an isolated workspace: a Git worktree for Git targets, or a timestamped run output folder for non-Git targets.

Before running any Git-backed action, Pi Actions should:

1. Resolve the configured `branch`.
2. Fetch/pull the latest version of that branch.
3. Create or update an action-owned worktree under `.pi/actions/<id>/worktree/`.
4. Run the action from that worktree.
5. Inject strong workspace-boundary instructions into the agent context.
6. Record the worktree path, branch, start commit SHA, and finish commit SHA/status in `memory.md` or run markdown.

Suggested layout:

```txt
.pi/actions/daily-bug-scan/
  action.yml
  memory.md
  worktree/
  runs/
```

This keeps branch changes, dependency installs, generated files, destructive edits, and agent experiments away from the user's active project. It also gives every run a historical codebase record: parent branch plus starting commit SHA. Git-backed actions must not commit directly to the parent branch. They should create/use an action run branch named `<parent-branch>-<action-id>-<yy-mm-dd-hh-mm>` and commit their work there at the end of the run when there are changes. PR submission only happens when the workflow or user prompt explicitly asks for it.

Commit messages should be standard and automation-prefixed, e.g.:

```text
<action-id>: run action at <yy-mm-dd-hh-mm>

Summary:
- ...
```

The subject should be descriptive enough to identify the automation and run without requiring the user to open the commit body.

Agent workspace guardrails:

- The action prompt must clearly state the action worktree path and the original project checkout path.
- The agent must be told to treat the original checkout as read-only/out of bounds.
- The agent must be told not to `cd`, edit, write, install, checkout, reset, or run mutating commands outside the action worktree.
- Any changes must happen inside `.pi/actions/<id>/worktree/` unless the user explicitly asks otherwise during an interactive session.
- If the agent believes it needs to touch the original checkout, it should stop and ask.

Example injected context:

```text
You are running Pi Action <id>.
Your working directory is the isolated action worktree: <repo>/.pi/actions/<id>/worktree.
The user's live checkout is <repo>. Treat it as out of bounds.
Do not modify files, switch branches, install dependencies, or run mutating commands outside the action worktree. Never commit to the parent branch.
Record evidence using branch, commit SHA, files, and diffs from the action worktree.
```

### Non-Git directory runs

Pi Actions should work outside Git repos without copying arbitrary folders. Non-Git targets use a tidy-up folder model instead of git worktrees.

For a non-Git target, each run creates a timestamped action folder inside the target's Pi actions area:

```txt
<target>/.pi/actions/<id>/runs/<timestamp>/
  files/
    plan.md
```

The agent may still produce new work during the automation run. New or replacement files should be written under `files/`, preserving relative paths. Destructive file/folder operations such as deletes, moves, renames, and large reorganizations should be plan-first: describe them in `files/plan.md` and leave execution to the user or a follow-up Pi session.

Example:

```txt
Downloads/.pi/actions/tidy-downloads/runs/2026-05-30T09-00-00Z/
  files/
    plan.md
    invoices/renamed-file.pdf
    notes/archive-plan.md
```

Non-Git agent guardrails:

```text
You are running Pi Action <id> against a non-Git target.
The target directory is <target>.
Your run output directory is <target>/.pi/actions/<id>/runs/<timestamp>.
Do not copy the whole target directory.
Do not delete, move, rename, or reorganize files/folders in the target directory during the automation run.
Write new or replacement files under files/, preserving relative paths.
Write files/plan.md with proposed destructive operations, source paths, destination paths, reasoning, and step-by-step instructions a follow-up agent can execute after user approval.
Update memory.md with a rough run summary and anything future runs should remember.
If direct destructive modification seems necessary, stop and explain why.
```

This creates an audit trail even without Git. It lets safe creation happen while keeping destructive tidy-up work reviewable: “create an X post from this week’s docs” can write a draft under `files/`, while “tidy Downloads” can produce a concrete markdown plan instead of moving files around. A normal future Pi session can then inspect `.pi/actions/*/runs`, review `files/plan.md`, and help the user apply or clean up the outputs.

### Agent reference material

Pi Actions should ship agent-facing guidance/skill material for working with action runs. It should cover:

- how to inspect `.pi/actions/<id>/runs/<timestamp>/`
- how to compare non-Git run plans/outputs with the target directory
- how to summarize proposed changes
- how to execute `files/plan.md` after user approval
- how to help the user apply, discard, or tidy generated files
- how to respect Git worktree boundaries and non-Git target boundaries

### Failures

Pi Actions should not impose action timeouts by default; some actions may be intentionally long.

If Pi or the provider hard-fails, the run stops and records the failure in `memory.md` when possible. If a workflow step fails, later steps stop by default. There is no `continue-on-error` field for now.

The failure report should be concise and useful: action id, failed step, error text, and any partial findings that are safe to preserve.

### Concurrency

Pi Actions should be robust enough that a single Pi session does not accidentally start the same action twice. A lightweight lock is still useful for edge cases: multiple Pi windows, a cron run overlapping a manual run, or a sidecar run racing with a scheduled invocation.

Default rule: one active run per action id. If a lock exists, a new run should report that the action is already running and point to the active run summary/status where possible.

The lock should be simple and disposable, not a custom scheduler state machine. It can live under the action folder and include pid/start time/run id if useful for stale-lock cleanup.

### Session behavior

- `session: fresh`: each run starts from fresh context and does not persist a native Pi session by default.
- `session: continue`: workflow reuses an action-scoped session/memory so the agent can compare with prior runs.
- Run context is injected into the agent: workflow id, trigger, previous memory summary, relevant command output, and current step.

### Memory and sessions

Pi Actions uses markdown memory for durable, human-readable continuity. Native Pi session files are still used when an action is configured to continue its own session.

Each action owns a persistent `memory.md` beside `action.yml`:

```txt
.pi/actions/daily-bug-scan/
  action.yml
  memory.md
  session/
  worktree/
  runs/
```

`memory.md` is always present and stores concise, curated cross-run context:

- what this action is trying to do
- important user preferences
- recurring findings
- last useful run summary
- things the next run should remember

Session behavior:

- `session: fresh` / ephemeral runs use `--no-session`. The agent must update `memory.md` because future runs will not have a Pi session to resume.
- `session: continue` uses a saved Pi session file under `.pi/actions/<id>/session/`, for example `--session-dir .pi/actions/<id>/session --session-id main`. The agent should still update `memory.md` as a durable fallback.

Why both for continued sessions: the JSONL session is the real resumable Pi context, while `memory.md` is the readable recovery path. If the continued session drifts, bloats, or gets poisoned, the user can reset/delete the session file and keep useful continuity from `memory.md`.

Each run stores human-readable generated artifacts under `runs/<timestamp>/`:

```txt
.pi/actions/daily-bug-scan/runs/2026-05-30T09-00-00Z/
  files/
    plan.md
```

Avoid extra metadata unless it is actually needed. Branch/SHA/worktree details can be written into `memory.md` or `files/plan.md`; structured metadata should be introduced only when the TUI/runner needs it. The main narrative belongs in `memory.md`.

## Storage

Definitions are file-backed. Runtime state is minimal and local.

Runtime state should only exist where the runner/TUI cannot infer state from files or Pi itself. Resumption should use Pi session behavior such as `pi -c` / `--continue`, not a custom state machine.

Acceptable local state:

- lightweight active-run/lock marker
- last/next scheduled run when schedules are used

Per-run details should primarily live in `memory.md` and `runs/<timestamp>/files/plan.md`, not a pile of structured JSON.

## Notifications

Users should be notified when actions finish. The earlier `notify` field is removed; notification policy belongs to the host/user settings, not individual workflow YAML.

Run output should make the result obvious through `memory.md`, run artifacts, active-run UI, and final sidecar/custom messages. Host apps can later decide how noisy or quiet notifications should be.

## Cleanup and retention

Pi Actions keeps work artifacts by default. Users should be able to inspect what happened before anything is deleted or applied.

Git worktrees are not auto-cleaned. They remain under `.pi/actions/<id>/worktree/` until the user explicitly cleans them up. A Pi UI can provide cleanup affordances, but cleanup is manual/explicit.

Non-Git run folders are also kept by default:

```txt
.pi/actions/<id>/runs/<timestamp>/
```

Pi Actions should ship a cleanup/apply prompt or command, e.g. `/actions clean`, that asks the agent to inspect action run folders, review `memory.md` and `files/plan.md`, and help the user apply, merge, discard, or tidy generated files. This should be user-driven, not automatic.

## Action status

Actions can be saved as:

- `manual`: available to run on demand, not scheduled.
- `scheduled`: recurring according to `on.schedule` / `rrule` style triggers.
- `paused`: defined but not eligible for automatic runs. Useful for temporarily disabling a recurring action without deleting it.

`workflow_dispatch` may still exist on any action so users can run it manually from TUI/CLI.

## TUI requirements

TUI should provide:

- list workflows
- show enabled/paused/manual/scheduled status
- show last run and next run
- run now
- pause/resume local override
- inspect validation errors
- inspect run history
- open/edit workflow file using the user's editor if available
- structured create/edit wizard
- raw YAML editor
- run log streaming
- schedule preview

## Agent-facing API

Agents should be able to:

- list workflows
- validate workflows
- create or edit workflow files
- run workflows
- inspect recent run results

## Future convenience script

A package-installed script can give users a nicer command to add to PATH:

```bash
pi-actions run daily-bug-scan
pi-actions due
```

This script should only translate arguments into normal Pi invocations, for example:

```bash
pi --action daily-bug-scan --print
pi --actions-due --mode json
```

It must not become a second runner. Pi remains the runner; the script is just terminal UX sugar.

## Implementation questions

- What exact extension flag shape should cron/systemd/launchd call with `--print`: `pi --action <id> --print`, `pi --actions-due --mode json`, or both?
- Should the package also ship a `pi-actions` PATH script as terminal UX sugar after the flag UX is stable?
- What exact session file layout should `session: continue` use under `.pi/actions/<id>/session/`?
- What should the `/actions clean` prompt/command include for applying or tidying kept worktrees and non-Git run folders?
- How should the UI present target folders, especially home/global-looking non-Git actions?

## Acceptance criteria

- A repo or non-Git target can contain `.pi/actions/<id>/action.yml` workflows with `version: 1`.
- Action ids are strict slugs; UI/agent-created labels are normalized into slugs.
- When invoked from a Git subfolder, Pi Actions stores definitions/artifacts at the Git root while preserving the origin subfolder as action `cwd` scope.
- Pi Actions can list and validate workflows from the current repo.
- User can run a workflow manually from TUI.
- User can run a workflow non-interactively through Pi CLI.
- Workflow can execute `run`, `ask`, and `skill` steps in order.
- Workflows declare `mode: read-only` or `mode: destructive`.
- Workflows declare `status: manual`, `scheduled`, or `paused`.
- Git-backed workflows create/update and run inside `.pi/actions/<id>/worktree/` for the configured parent branch.
- Git-backed workflows commit changes to `<parent-branch>-<action-id>-<yy-mm-dd-hh-mm>`, never to the parent branch.
- Non-Git workflows create timestamped run output folders under `.pi/actions/<id>/runs/<timestamp>/`.
- Agent context includes explicit workspace-boundary guardrails for Git and non-Git runs.
- Run markdown/memory records workspace backend, output/worktree path, and Git branch/SHA data when available.
- Run status and results are recorded into `memory.md` and human-readable run artifacts; native Pi session files are saved only for `session: continue`.
- Invalid YAML produces useful errors with file/field context.
- Failed runs stop by default and report the failure in `memory.md` when possible.
- Agent-facing API can list, validate, create, inspect, and run workflows.
- Users can point cron, systemd timers, launchd, CI, or shell scripts at the non-interactive Pi command.
- Users can run Pi Actions as a sidecar for their current session using Pi RPC mode.
- Sidecar runs show a running widget and write final summary messages as display-only ignored transcript messages.
- Pi Actions disables itself inside child Pi processes to prevent nested action runners.
- Actions show active run state in the app when invoked from the host app or visible to it.
- The same action id cannot run twice concurrently by default; overlapping invocations report the active run.
- Worktrees and non-Git run folders are kept by default and cleaned only by explicit user action.
- Workflows can run on session start/end and other lifecycle triggers, similar to Pi hooks but defined in YAML.
