# Recover a Deno Notebook in TS Notebook

## Default paths

| OS | Pi agent directory | Pi session files to keep |
| --- | --- | --- |
| Linux and macOS | `~/.pi/agent` | `~/.pi/agent/sessions` |
| Windows | `%USERPROFILE%\.pi\agent` | `%USERPROFILE%\.pi\agent\sessions` |

Use `PI_CODING_AGENT_DIR` if set. Pi can also store session files elsewhere via `PI_CODING_AGENT_SESSION_DIR` or `--session-dir`. Do not delete sessions, wherever they live.

Under the agent directory, `cache/pi-codex-conversion/notebook-mode/` contains the Deno runtime (`deno-*/`), journals (`journals/`), checkpoints (`sessions/`), project bindings and conflicts (`projects/`), and profiles and isolated candidates (`profiles/`). On Windows, use backslashes for native shell paths. Old kernels can also leave `pi-codex-deno-kernel-*` and `pi-deno-isolated-*` directories in the OS temporary directory (on Unix, the system temp directory or `$TMPDIR`; on Windows, usually `%TEMP%`).

## Recovery prompt

Paste this into Pi and replace the bracketed text with a session, profile or project you want to recover. If the original Deno session is still open, leave it open until the agent has checked for unsaved state.

```text
Recover my Deno Notebook and adapt it to the current TS Notebook runtime.

Source: [Pi session, notebook profile or project]
Work I want back: [helpers, data or workflow]

Pi's agent directory is ~/.pi/agent on Linux or macOS, %USERPROFILE%\.pi\agent on Windows, or PI_CODING_AGENT_DIR if set. Deno Notebook saved its data under cache/pi-codex-conversion/notebook-mode in that directory. The journals, sessions, projects and profiles subdirectories hold different kinds of state. Pi conversation files live separately, usually in the agent directory's sessions folder.

1. Inspect the original without resetting it or overwriting anything. If the Deno kernel is still open, check for unsaved or live-only state before switching modes. Use saved checkpoints, project bindings and profiles for data. Use the saved notebook or Pi session history to recover source and understand what the cells did. Do not replay old cells or their side effects.

2. Recover the values and helpers needed for the workflow. Adapt Deno APIs and imports to the current Node-based TS Notebook. Recover pinned helpers where needed, but leave hooks off until you have checked their behaviour. If a value or dependency cannot be recovered, identify it rather than guessing.

3. Rebuild in a fresh TS Notebook session without replacing existing TS state. Use the current notebook tool's usage to check the available actions. Verify the helpers with read-only inputs or a disposable copy, then save and verify a checkpoint or a new named profile. Leave the original notebook and its files intact.

4. Tell me what you recovered, what you verified in TS, where you saved it, and what still needs Deno or my input. Carry on with the recoverable work if something is missing.
```

## Cleanup prompt

Paste this separately when you no longer need the old notebook. Cleanup permanently removes saved Deno Notebook work.

```text
Delete Pi Codex's old Deno Notebook artifacts on [machines to clean]. I no longer need that saved notebook state.

Use the active Pi agent directory: ~/.pi/agent on Linux or macOS, %USERPROFILE%\.pi\agent on Windows, or PI_CODING_AGENT_DIR if set. Check for running Deno Notebook kernels and old Pi Codex processes holding notebook state open. If either is active, leave that directory alone and tell me which session needs to exit or restart.

Remove only cache/pi-codex-conversion/notebook-mode under that agent directory, including its journals, checkpoints, profiles, project state and downloaded Deno binary. Remove abandoned pi-codex-deno-kernel-* and pi-deno-isolated-* temp directories only if you confirm that Pi Codex created them and no process is using them.

Keep all Pi sessions, ts-state, other Pi Codex caches and unrelated Deno installs, dependencies and projects. Do not remove a shared Deno cache. Verify what's gone and report anything you skipped.
```
