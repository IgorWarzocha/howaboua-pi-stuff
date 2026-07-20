# Trigger design status

The worker loop is implementable. Deciding when to launch it remains unresolved.

## Current conclusion

Git and code metrics can scope a hardening pass, but they cannot authorize one. A commit, new file, large diff, high churn, or repeated edit does not establish that modularisation is warranted. Treating any of those as semantic evidence would turn scheduling convenience into false architectural certainty.

The prototype currently launches after a settled parent run changes source on a non-trunk branch. That proves the lifecycle and worker mechanics, but it is intentionally too eager and is not an accepted final trigger policy.

## What the prototype establishes

- branch-layer selection through the nearest `dev`, `develop`, `main`, or `master` merge base
- factual candidate ranking without metric-derived architectural claims
- one isolated worker retaining normal global and trusted project extensions
- suppression of auto-hardening only in worker descendants, preventing recursion
- structural-only worker instructions: no invented features, no new tests, and no delegation
- `[complete]` and `[blocker] reason` completion markers
- existing checks and another full-diff inspection before handoff when a pass changes code

## Open trigger question

A future trigger must be programmatic. The unresolved problem is which observable signals or state can justify launching the worker without laundering mechanical activity into an architectural claim. Options worth testing include:

- programmatic analysis of changed code topology and ownership signals
- an opt-in signal emitted by the already-running parent agent and consumed by the extension
- an explicit user command or workflow boundary
- a separate lightweight semantic evaluator
- integration with review, handoff, or pre-PR workflows

None is implemented as the final policy. In particular, the parent-agent marker discussed during design is only a candidate, not part of this prototype.

Any chosen design must make cost and false-positive behavior visible, preserve a manual path, avoid repeated processing of the same state, and never present mechanical Git facts as proof that refactoring is needed.
