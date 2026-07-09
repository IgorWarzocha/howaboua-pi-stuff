# Scoring Rubric (0-10)

Use this rubric only when the user requested scoring or a broad audit genuinely benefits from a scorecard. Scores summarize evidence; they are not objective measurements. State the inspected scope, cite files/commands, and use `not assessed` rather than inventing precision where evidence is missing.

Apply explicit godfile/godfunction penalties when the hotspot is material to the inspected system. A repo should not receive a high structure score merely because it is typed or tested while central paths remain mixed, but one isolated hotspot in a large codebase should not erase otherwise strong architecture.

## 1) agent_native
0-2: monoliths/godfiles/godfunctions, unclear ownership, no guardrails
3-5: partial modularization, weak lane boundaries, mixed concerns still central
6-8: clear feature modules, low duplication, boundaries enforced by scripts/lint
9-10: independent changes are low-overlap, extension points are explicit, and feature ownership is obvious with little unstable duplication

## 2) contract_safety
0-2: contracts are mostly implicit, unchecked dynamic data is pervasive, or validation is absent
3-5: some contracts exist, but weak enforcement, unsafe conversions, duplicated data shapes, or flag-bag states remain
6-8: contracts are enforced in major lanes, unsafe edges are limited, shapes are mostly derived from a source of truth
9-10: contracts are strict across boundaries, invalid states are modeled out, and end-to-end data flow is preserved where tooling supports it

## 3) traversable
0-2: hard to locate ownership and flows, godfiles/godfunctions dominate navigation
3-5: partial structure, large hotspots remain, feature boundaries blurry
6-8: clear feature folders, reduced hotspots, entrypoints mostly obvious
9-10: small focused modules with stable entrypoints and crisp separation of concerns

## 4) test_coverage
0-2: no tests
3-5: some deterministic tests exist, but risky core behavior or contract boundaries are unprotected
6-8: fit-for-purpose deterministic tests protect important behavior and match the repo's established test complexity
9-10: lightweight, high-signal coverage protects critical deterministic behavior, failure paths, and contracts without flaky tests or coverage theater

Score test coverage by fitness, not volume. A small pragmatic suite can score 9-10 when it protects the codebase's real risk surface and matches the repo's testing intent. Do not penalize lightweight tests just because they are few. Penalize missing tests for risky core logic, flaky/slow tests, unmaintainable fixture or mock complexity, snapshot sprawl, and tests added mainly to raise a number.

## 5) feedback_loops
0-2: no consistent checks
3-5: lint/static analysis or contract checks only in one lane
6-8: repo-wide lint/static analysis/contract checks/tests wired into one command
9-10: fast, reliable, enforced CI-style local gates

## 6) self_documenting
0-2: stale docs, no strategic comments, structure hides ownership
3-5: partial comments/docs, weak discoverability, mixed concerns still require rereads
6-8: strategic comments + concise lane map + feature ownership mostly obvious
9-10: high-signal comments, accurate material docs, and file/folder layout explain the system with little rereading

## Godfile / Godfunction / Boundary Criteria

Treat these as strong negative signals:
- one file or folder absorbing unrelated features, orchestration, IO, types, and UI
- repeated cross-feature edits landing in the same catch-all module
- broad `utils`/`helpers`/`misc` dumping grounds with weak ownership
- copy-paste logic across features where a stable shared abstraction should exist
- hidden side effects or mixed layers that make extraction risky
- godfunctions that mix unrelated responsibilities, such as validation, orchestration, IO, mutation, rendering, and error handling in one long flow
- central handlers or lifecycle methods that keep absorbing feature-specific branches instead of delegating to feature-owned code
- root app/controller objects owning feature-local state, input handling, async task coordination, and rendering decisions
- global dispatch functions that grow with every feature instead of delegating to feature-owned handlers or explicit commands
- positional data flowing through domain logic: magic indexes, parallel arrays, tuple rows, or string lists whose meaning depends on order
- scattered manual reset/cleanup patterns that reveal unmodeled state transitions or lifecycle ownership

Treat these as strong positive signals:
- godfiles decomposed into feature folders with clear ownership
- godfunctions decomposed into small named steps with clear ownership and explicit inputs/outputs
- feature-local modules separated by concern where needed (`index`/entrypoint, domain logic, IO, types/schema, tests)
- shared abstractions extracted only when genuinely cross-feature and stable
- explicit state variants, domain-specific value types, validators, and derived contracts replace ambiguous primitives or manually duplicated shapes
- lower fan-in/fan-out per module and fewer unrelated edits per lane
- central paths are small routers/registries; feature behavior lives behind explicit, contracted extension points
- async/background work communicates through explicit messages/events/results, with one clear state mutation owner
- domain data keeps named fields until render/serialization boundaries

Calibration guardrails for material central-path problems:

- a godfile that owns several unrelated core responsibilities usually keeps `agent_native` and `traversable` at 5 or below
- a central godfunction that mixes orchestration, domain rules, IO, and mutation usually keeps `agent_native` and `traversable` at 6 or below
- multiple central godfiles/godfolders usually keep `agent_native`, `traversable`, and `self_documenting` at 4 or below
- persistent duplication combined with mixed ownership usually keeps `agent_native` at 6 or below until an owner boundary is clear

Treat these as calibration, not arithmetic. Explain any cap applied and adjust for repository size, generated/framework structure, inspected scope, and whether the hotspot is central or isolated.
