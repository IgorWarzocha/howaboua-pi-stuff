# Pi Automations PRD

## Summary

Pi Automations is a file-backed automation engine for Pi agents. It lets users define recurring or manual agent workflows in a repo using readable YAML, run them from Pi TUI, and surface the same workflows in Howcode's Automations view.

The core idea: **GitHub Actions-shaped files for local agent work**.

```yaml
# .automations/daily-bug-scan.yml

name: Daily Bug Scan              # List title in Automations.

on:
  workflow_dispatch:               # Enables manual “Run now”.
  schedule:
    - cron: "0 9 * * *"            # GitHub Actions-style schedule.

jobs:
  bug_scan:
    branch: main                    # Optional target branch/worktree.
    session: continue               # fresh | continue.
    notify: changes                 # quiet | failures | changes | always.

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

- Make automations easy for agents and humans to write.
- Keep automation definitions portable, inspectable, and versionable.
- Provide a good Pi TUI experience
- Support bash-only, agent-only, and mixed bash/skill/agent workflows.
- Store run history/state separately from source definitions.

## Non-goals

- Reimplement GitHub Actions. But do get close.
- Make workflow files app-owned hidden DB state.

## Target users

- Developers who want local recurring repo checks.
- Agents creating follow-up/watchdog workflows for users.

## Product shape

### Package / extension

- Package name: `pi-automations`.
- User-facing name: **Automations**.
- Runs as a Pi extension with a TUI GUI.

### Filesystem

Possible later folder form for larger workflows:

```txt
.automations/daily-bug-scan/
  automation.yml
  memory.md
```

Codex Desktop uses `~/.codex/automations/<id>/automation.toml + memory.md`; we should borrow the adjacent-memory idea where useful, but keep Pi Automations repo-local and YAML-first.

## Workflow schema v1

### Top-level fields

- `name`: human-facing title.
- `description`: optional short explanation.
- `on`: triggers.
- `jobs`: one or more jobs. V1 may execute one job at a time, but keeping `jobs` preserves familiar Actions grammar.

### Triggers

V1:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "0 9 * * *"
```

Later:

- `rrule` for calendar-like schedules.
- file/git events.
- external app/webhook events.

### Job fields

- `branch`: optional target branch/worktree.
- `working-directory`: optional path relative to workflow cwd.
- `session`: `fresh` or `continue`.
- `notify`: `quiet`, `failures`, `changes`, or `always`. //debatable
- `timeout-minutes`: optional guardrail.
- `env`: optional environment variables.
- `steps`: ordered workflow steps.

### Step types

V1 step types:

```yaml
- run: git status --short
```

Runs a shell command. Output becomes run log and context for later agent steps.

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

Injects/uses a named skill as a first-class step. This aligns with Codex's `SkillInput(name, path)` direction.

## Runtime behavior

### Manual run

- User selects workflow via `/automations` gui or types in `/automation <name>`.
- Runner validates YAML.
- Runner creates a run record. /debatable since the run record is the pi session
- Steps execute in order.
- Run status updates live in TUI

### Scheduled run //this has to be discussed

- Scheduler scans loaded workflows.
- Due runs are claimed once.
- Missed runs after app restart are reconciled conservatively.
- V1 should avoid surprise catch-up storms.

### Session behavior

- `session: fresh`: each run creates a new agent session.
- `session: continue`: workflow reuses an automation session/memory so the agent can compare with prior runs.
- Run metadata should be injected into the agent as automation context, e.g. workflow id, trigger, previous run summary, and relevant command output.

### Memory

V1 options to decide during implementation:

1. Runtime-owned memory in app state/DB.
2. Adjacent `memory.md` beside workflow files.
3. Hybrid: repo-local memory optional, runtime memory default.

Bias: keep run logs/state out of git by default, but allow a markdown memory file for explicit persistent context.

## Storage //debatable

Definitions are file-backed. Runtime state is not.

Runtime state should store:

- workflow file path and content hash
- workflow id/name snapshot
- run id
- trigger type
- status
- started/finished timestamps
- step logs/status
- session path/thread id where applicable
- notification decision
- last/next scheduled run

## TUI requirements

V1 TUI should provide:

- list workflows
- show enabled/paused/manual/scheduled status
- show last run and next run
- run now
- pause/resume local override
- inspect validation errors
- inspect run history
- open/edit workflow file using the user's editor if available

Nice later: //this is probably incorrect.

- structured create/edit wizard
- raw YAML editor
- run log streaming
- schedule preview


## Open questions

- `.automations/*.yml` vs `.automations/<id>/automation.yml` for v1?
- Cron-only v1, or support RRULE from day one?
- Should `notify: changes` require an explicit agent classification output?
- How much of scheduling lives in the extension versus the host app?
- Should paused/enabled overrides live in source YAML or local runtime state?
- What is the safest branch/worktree behavior for scheduled runs?

## V1 acceptance criteria

- A repo can contain at least one `.automations/*.yml` workflow.
- Pi Automations can list and validate workflows from the current repo.
- User can run a workflow manually from TUI.
- Workflow can execute `run`, `ask`, and `skill` steps in order.
- Run status and logs are recorded.
- Invalid YAML produces useful errors with file/field context.
- a skill for the agent?
- a tool for the agent?
- REQUIRED: users can run pi non-interactively for this.
- users can run Pi as a sidecar session for their current sesion
- automations reuse the clock ran from the host app or something that will just run them and show a widget that an automation is running
- automations can work on session start/end or any other trigger - kinda replicating pi hooks but grabbing what to do from the yamls.
