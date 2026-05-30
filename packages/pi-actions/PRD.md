# Pi Actions PRD

## Summary

Pi Actions is a repo-local, file-backed actions runner for Pi agents. Users define workflows in readable YAML, run them from the Pi TUI, or run them non-interactively from a terminal command that can be called by cron, systemd timers, launchd, CI, or shell scripts.

The core idea: **GitHub Actions-shaped workflows for local agent work**.

```yaml
# .pi/actions/daily-bug-scan/action.yml

name: Daily Bug Scan

description: Look for likely regressions in recent commits.

on:
  workflow_dispatch:
  schedule:
    - cron: "0 9 * * *"

jobs:
  bug_scan:
    branch: main
    session: continue
    notify: changes

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

## Workflow schema

### Top-level fields

- `name`: human-facing workflow title.
- `description`: optional short explanation.
- `on`: triggers.
- `jobs`: one or more jobs.

### Triggers

```yaml
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

### Job fields

- `branch`: optional target branch/worktree.
- `working-directory`: optional path relative to workflow cwd.
- `session`: `fresh` or `continue`.
- `notify`: `quiet`, `failures`, `changes`, or `always`.
- `timeout-minutes`: optional guardrail.
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
- `--session-dir <dir>` can store action sessions inside the action folder.
- `--session-id <id>` can create/reuse a stable action session.
- `--session <path|id>`, `--continue`, `--fork`, and `--no-session` cover resume/fork/ephemeral behavior.
- `--tools`, `--exclude-tools`, `--no-tools`, and `--no-builtin-tools` let actions run with scoped tool access.
- `--skill <path>` can load action-specific skills.
- `--append-system-prompt <text|file>` can inject action metadata and guardrails.
- Extensions can register CLI flags, so Pi Actions can expose action-specific non-interactive entrypoints through Pi itself.

Proposed extension flag shape:

```bash
pi --action daily-bug-scan --print
pi --actions-due --mode json
```

`--action` and `--actions-due` are not built-in Pi flags; Pi Actions would register them with `pi.registerFlag()`. Use JSON mode for fire-and-forget terminal runs where the parent only needs event logs. Use RPC mode for sidecar runs where the extension needs to keep a child session alive, send follow-up prompts, poll state, render live widgets, stop the child, or inject results back into the current session. `pi-smart-btw` proves this shape with `pi --mode rpc --no-session` in a child process.

Pi extensions can register flags and slash commands, not new `pi actions run` subcommands. A future package-level wrapper script can provide a nicer PATH command while still calling Pi under the hood. It should remain a thin convenience shim, not a separate runner.

## Runtime behavior

### Manual run

- User selects a workflow via `/actions` or types `/action <name>`.
- Runner validates YAML.
- Runner creates a run record.
- Steps execute in order.
- Run status updates live in TUI.

### Non-interactive run

Pi Actions can run from a terminal without opening an interactive Pi session. This is the path for cron-like behavior. JSON mode is preferred here because it provides structured logs while still exiting when the run is done.

Primary non-interactive command shape:

```bash
pi --action daily-bug-scan --print
pi --actions-due --mode json
```

Users own scheduling. Pi Actions should be safe to invoke repeatedly from cron, systemd timers, launchd, CI, or shell scripts. Due runs are claimed once, and missed runs after downtime are reconciled conservatively to avoid surprise catch-up storms.

### Sidecar run

Pi Actions can also run as a sidecar from an active Pi session. This is an interactive extension behavior, likely exposed through `/action <id>` or the Actions TUI, not a terminal-only `--sidecar` flag. It should use Pi RPC mode, not JSON mode. The parent extension starts a child Pi process, keeps it alive while the action runs, streams status into the TUI, and can inject the result into the current session when useful.

This follows the `pi-smart-btw` pattern:

- spawn `pi --mode rpc` as a child process
- use `--session-dir .pi/actions/<id>/sessions` and `--session-id main` or a run id
- send prompts over RPC
- poll `get_state` for idle/running state
- collect `message_end`, `agent_end`, and tool events for logs/status
- stop the child explicitly when dismissed/cancelled
- optionally send a custom message or user message back to the parent session

JSON mode is still useful for logs, but RPC is the right primitive for live sidecars.

### Session behavior

- `session: fresh`: each run creates a new agent session.
- `session: continue`: workflow reuses an action-scoped session/memory so the agent can compare with prior runs.
- Run metadata is injected into the agent as action context: workflow id, trigger, previous run summary, relevant command output, and current step.

### Memory

Each action folder can own its Pi sessions. This keeps long-lived action context next to the workflow while still separating source definition from generated runtime files.

Suggested layout:

```txt
.pi/actions/daily-bug-scan/
  action.yml
  memory.md
  sessions/
    main.jsonl
    runs/
      2026-05-30T09-00-00Z.jsonl
```

Session behavior maps directly to Pi CLI flags:

- `session: continue` uses `--session-dir .pi/actions/<id>/sessions --session-id main`.
- `session: fresh` uses `--session-dir .pi/actions/<id>/sessions --session-id runs/<run-id>` or forks from `main`.
- ephemeral or dry exploratory runs may use `--no-session`.

Runtime memory is stored outside `action.yml` by default. Workflows may opt into adjacent `memory.md` when persistent repo-local context is useful.

Bias: keep generated run logs/state out of git by default, but allow explicit markdown memory for persistent context.

## Storage

Definitions are file-backed. Runtime state is not.

Runtime state should store:

- workflow file path and content hash
- workflow id/name snapshot
- run id
- trigger type
- status
- started/finished timestamps
- step logs/status
- session directory and session id/path where applicable
- notification decision
- last/next scheduled run

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

- Should `notify: changes` require an explicit agent classification output?
- What exact extension flag shape should cron/systemd/launchd call: `pi --action <id> --print`, `pi --actions-due --mode json`, or both?
- Should the package also ship a `pi-actions` PATH script as terminal UX sugar?
- Should sidecar runs default to `session: continue` so repeated sidecar invocations share `.pi/actions/<id>/sessions/main`?
- Should paused/enabled overrides live in source YAML or local runtime state?
- What is the safest branch/worktree behavior for non-interactive scheduled runs?

## Acceptance criteria

- A repo can contain `.pi/actions/<id>/action.yml` workflows.
- Pi Actions can list and validate workflows from the current repo.
- User can run a workflow manually from TUI.
- User can run a workflow non-interactively through Pi CLI.
- Workflow can execute `run`, `ask`, and `skill` steps in order.
- Run status and logs are recorded from Pi JSON/session events.
- Invalid YAML produces useful errors with file/field context.
- Agent-facing API can list, validate, create, inspect, and run workflows.
- Users can point cron, systemd timers, launchd, CI, or shell scripts at the non-interactive Pi command.
- Users can run Pi Actions as a sidecar for their current session using Pi RPC mode.
- Actions show active run state in the app when invoked from the host app or visible to it.
- Workflows can run on session start/end and other lifecycle triggers, similar to Pi hooks but defined in YAML.
