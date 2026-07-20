# @howaboua/pi-auto-hardening

Automatic, diff-scoped architecture hardening for Pi.

After an agent changes source on a non-trunk branch, the extension compares the active branch layer against the closest local `dev`, `develop`, `main`, or `master` history and starts one isolated hardening worker. The worker retains the normal global and trusted project extensions, inspects programmatic hotspot evidence, makes its own semantic judgments, and continues in the same context until the diff is clean or work is blocked.

## Install

```bash
pi install npm:@howaboua/pi-auto-hardening
```

Installation enables the hook. It is intentionally not included in the general extension bundles because it can edit working files automatically.

## Behavior

- Runs after the parent agent fully settles, and only when that run changed repository state containing source files.
- Skips `main`, `master`, detached HEADs, generated output, dependencies, vendor trees, and diffs without source candidates.
- Chooses the closest merge-base layer: trunk for `dev`/`develop`, and the nearest integration or trunk branch for feature work.
- Launches the worker with the current model, thinking level, extensions, skills, context files, and project trust.
- Treats churn, size, changed hunks, and module statements as candidate facts—not architectural findings.
- Uses final-line `[complete]` and `[blocker] reason` markers instead of adding a worker-only status tool.
- On completion, runs `git diff --check` and the nearest existing package `check` scripts, or the repository's existing Cargo/Go check when applicable. Failures are returned to the same worker.
- Requires another full-diff inspection whenever the completed pass changed repository state. Repeated unchanged unmarked output and a twelve-pass emergency ceiling stop runaway loops.
- Never commits changes.

Subagents launched by the hardening worker inherit all normal extensions, but this extension disables its own controller and worker hooks in those descendants to prevent recursion.

## Branch model

The extension reads existing local and `origin/*` refs without fetching them. Keep the relevant base refs current when accurate branch-layer selection matters.

## License

MIT
