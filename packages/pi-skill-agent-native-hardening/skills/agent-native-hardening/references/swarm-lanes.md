# Swarm Lane Templates

Use lanes as a planning primitive, not only as worker-agent branches. A lane can be:

1. **Discovery lane**: read-only exploration for evidence gathering, hotspot mapping, dependency tracing, or lane planning. It may be done directly or by an explore-style subagent. No worktree, edits, or commits required.
2. **Implementation lane**: a bounded code/doc change with one objective and clear validation. It may be done directly, by a coding subagent, or in a worktree/branch when parallelism or isolation helps.
3. **Stabilization lane**: integration, conflict resolution, full checks, and small fixes caused by previous lanes.

Choose the lightest mechanism that keeps the work safe and comprehensible. Prefer explore-style agents for broad reconnaissance; prefer worktrees only when parallel edits or risky refactors need isolation.

## Discovery Lane Templates

### Discovery A: Repo Map + Commands
- Scope: package/workspace layout, scripts, tsconfigs, test runners, lint/format tooling
- Goal: identify active checks and repo boundaries before scoring
- Output: command list, workspace map, missing/unclear checks

### Discovery B: Hotspots + Godfiles
- Scope: oversized files, catch-all folders, high fan-in/fan-out modules, mixed layers
- Goal: rank structural refactor candidates with file evidence
- Output: hotspot list with why each one hurts traversability or ownership

### Discovery C: Duplication + Boundary Drift
- Scope: repeated logic, duplicated data shapes/contracts, broad utils/helpers/common folders, cross-feature imports
- Goal: identify DRY and separation-of-concerns problems without inventing premature abstractions
- Output: duplicate patterns, proposed owner boundary, avoid/extract recommendation

### Discovery D: Contract Safety Drift
- Scope: unchecked dynamic values, unsafe conversions, flag bags, optional-field state objects, manual contract copies, primitive soup
- Goal: find places where invalid states are representable or contracts drift across layers
- Output: candidate fixes using derived contracts, explicit state variants, validators, or domain-specific value types

### Discovery E: Scope + Centralization Pressure
- Scope: recent feature growth, root app/controller size, global dispatch handlers, route/action registries, async/background task wiring, feature flags/config bloat
- Goal: find places where low-friction feature additions are accumulating hidden architectural debt or widening product scope
- Output: centralization hotspots, feature-local ownership candidates, explicit defer/keep recommendations for scope-expanding work

### Discovery F: Positional Data + Lifecycle Drift
- Scope: arrays/tuples/parallel arrays used as domain data, magic indexes, flattened rows, scattered state resets, nullable lifecycle flags
- Goal: identify implicit contracts and unmodeled transitions that confuse agents and invite off-by-one or stale-state bugs
- Output: candidates for named domain objects, explicit lifecycle states, shaped messages/events, or owned state machines/reducers

## Implementation Lane Templates

### Lane A: Quality Gates
- Scope: scripts + tsconfig + lint boundaries
- Goal: repo-wide `check` includes all active lanes
- Typical files: root/package scripts, lane tsconfig files

### Lane B: Deterministic Tests
- Scope: pure logic tests only
- Goal: protect event transforms / reducers / guard handlers
- Typical files: `tests/**/*.test.ts` + script wiring

### Lane C: Hotspot Modularization
- Scope: split one large file by concern
- Goal: shrink hotspot and improve navigability
- Typical outputs: 2-4 new focused modules, no behavior change

### Lane D: Setup/Runtime Hardening
- Scope: process lifecycle and failure path logic
- Goal: explicit boundaries and invariant comments
- Typical outputs: runner/orchestrator split + helper modules

### Lane E: Discoverability
- Scope: strategic comments + one concise lane-map doc
- Goal: reduce reread cost for agents
- Rule: one doc max unless user requests more

### Lane F: Contract Hardening
- Scope: domain value types, schemas/validators, API/client contracts, event payloads, ambiguous function signatures
- Goal: reduce invalid states, duplicated contracts, unsafe conversions, ambiguous positional args, and boundary drift
- Typical files: schemas, DB models, API handlers, client contracts, domain types

### Lane G: State Ownership + Extension Points
- Scope: root app/controller dispatch, input/action handlers, async task messages, render/view boundaries
- Goal: move feature-specific branches and state into feature-owned modules while keeping central paths as contracted routers/registries
- Typical files: app/router/controller entrypoints, feature action modules, reducers/state machines, message/event types

### Lane H: Scope Guardrails
- Scope: architecture invariants, feature acceptance criteria, extension-point rules, minimal product map
- Goal: prevent “easy” features from becoming accidental scope creep or central-handler bloat
- Typical outputs: concise invariant comments, one lane-map section, checklists in existing docs; avoid new broad prose docs

## Stabilization Lane Template
- Scope: merge conflicts, full repo checks, breakages introduced by prior lanes
- Goal: make the final state coherent without expanding scope
- Rule: fix only real integration/hardening breakages; defer unrelated cleanup
