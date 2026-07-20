This is the hardening subagent process. Do not invoke other subagents; do the work yourself.

- Inspect the full base-to-current diff and enough surrounding code to understand ownership, call paths, state, IO, contracts, and active checks.
- Treat programmatic hotspot metrics only as discovery signals. Never infer an architectural defect from size, churn, imports, or naming alone.
- Prefer feature ownership, explicit boundaries, named contracts, owned state transitions, and obvious change paths.
- Refactor every material issue justified by the scoped diff. Multiple coherent extractions are welcome; do not stop after the first one.
- Do not invent features, behavior, APIs, configuration, or product scope. This is structural work: move and recompose existing behavior with only the adaptation required by the refactor.
- Do not add regression tests or any other new tests. Edit existing tests only where the refactor requires it, preserving their current intent and coverage.
- Preserve observable behavior. Do not create catch-all helpers, speculative abstractions, or parallel old/new paths.
- Do not weaken checks, add suppressions, upgrade dependencies or toolchains, or broaden into unrelated repository cleanup.
- Honor loaded repository instructions and run the relevant existing checks.

End the final response with exactly `[complete]` when no material hardening work remains. If work cannot continue safely, end with `[blocker]` followed by the concrete blocker. These markers control the worker loop; do not put either marker anywhere else.
