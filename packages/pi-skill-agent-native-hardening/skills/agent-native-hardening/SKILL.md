---
name: agent-native-hardening
description: "Audits and improves codebase architecture for safe human and agent changes. Use for structural reviews or refactors involving ownership, godfiles/functions, feature boundaries, duplication, contract or state safety, traversability, feedback loops, test fit, work decomposition, or parallel-change readiness. Not for ordinary bug fixes or feature work with no architecture concern."
---

# Agent-Native Hardening

Make a codebase easier to understand and safer to change by clarifying ownership, reducing mixed responsibilities, strengthening contracts, and shortening reliable feedback loops. Optimize for humans and agents without imposing architecture theater.

## Reference map

Read only the references relevant to the task:

- `references/scoring-rubric.md` before assigning scores or producing a formal scorecard.
- `references/work-lanes.md` before splitting broad discovery or implementation across lanes, agents, branches, or worktrees.
- `references/dependency-safety.md` when dependency changes, installers, lockfiles, toolchains, package scripts, or supply-chain recommendations are in scope.
- `references/js-ts.md`, `references/python.md`, `references/rust.md`, or `references/go.md` for languages present in the target repo.

If no bundled language reference fits, use the general workflow and verify ecosystem-specific advice against the repo and current official documentation. Repo evidence and host constraints outrank generic guidance.

## Operating principles

1. **Evidence before prescription.** Inspect the real ownership, change paths, tooling, and failure modes before recommending a target architecture.
2. **Clear ownership over arbitrary size limits.** A large file is not automatically a godfile; the problem is unrelated responsibilities, hidden coupling, or repeated central-path edits.
3. **Feature ownership over catch-alls.** Prefer modules with clear domain or platform owners. Do not replace one godfile with `utils`, `helpers`, `common`, or excessive micro-files.
4. **Explicit contracts at boundaries.** Validate external data once, preserve named domain shapes internally, model state transitions, and derive contracts from a source of truth where practical.
5. **Stable reuse over premature DRY.** Extract duplication when the behavior is genuinely shared and has a clear owner; tolerate local duplication when semantics are still diverging.
6. **The shortest correct change path should be obvious.** Entry points, extension points, state owners, and validation commands should be discoverable without rereading the whole system.
7. **Tests follow risk.** Match the repo's established testing intent and protect consequential behavior; do not manufacture coverage, fixtures, mocks, snapshots, or end-to-end scaffolding by default.
8. **Failures stay visible.** Fix root causes instead of weakening checks, suppressing diagnostics, swallowing errors, or adding silent fallback behavior.

## Workflow

### 1. Establish scope and mode

- Determine whether the user wants a review, scorecard, plan, implementation, or combination.
- Respect the requested scope. Do not turn a focused module cleanup into a repo-wide program.
- For edits, inspect git state and repo instructions before changing files. A dirty tree does not block read-only review, but report it and do not overwrite unrelated work.
- Identify active format, lint/static-analysis, type/contract, test, build, and aggregate check commands.

### 2. Map the relevant system

- Trace entry points, feature owners, state mutation, IO boundaries, contracts, and affected checks.
- Inspect hotspots for mixed concerns, central-handler growth, hidden side effects, positional data, duplicated contracts, manual lifecycle resets, and broad cross-feature coupling.
- Distinguish generated/framework-required structure from code humans are expected to maintain.
- For broad or unfamiliar repos, use focused read-only discovery lanes when they reduce rereading. Direct inspection is sufficient when the scope fits one coherent context.

### 3. Form evidence-backed findings

- Cite concrete files, symbols, flows, or commands.
- Explain the change risk, not merely the aesthetic preference.
- Separate observed defects from inference and optional modernization.
- Rank only material findings. Mention healthy boundaries where they affect the recommendation.
- Score only when the user requested scoring or a broad audit would clearly benefit from it; then read `references/scoring-rubric.md` first.

### 4. Choose the smallest coherent intervention

- Prefer one owned extraction or contract boundary over a speculative architecture rewrite.
- Split by feature ownership first, then by concern where the feature needs it.
- Keep central paths as small routers, registries, or composition roots; move feature behavior behind explicit boundaries.
- Model impossible or ambiguous states with variants, enums, validators, domain values, or named objects appropriate to the language.
- For broad multi-area work, read `references/work-lanes.md` and create only as many lanes as have independent objectives and validation.

### 5. Implement without laundering failures

- Preserve behavior unless behavior change is explicitly in scope.
- Keep edits owned and traversable; avoid parallel abstractions that leave the old path alive.
- Run relevant checks during the work and the repo's appropriate aggregate check at the end.
- Do not make checks pass through broad ignores, weaker strictness, unsafe casts, blanket suppressions, skipped files, or unrelated test deletion.
- Do not upgrade dependencies, runtimes, compilers, package managers, or lint policy unless the user accepted that work.

### 6. Stabilize and report

- Verify the final ownership and call path, not only compilation.
- If parallel lanes or branches were used, integrate centrally and resolve overlap before final checks.
- Report what changed, why the new boundary is safer, validation run, and remaining material risks.
- For review-only work, lead with severity-ordered findings and stop without implementation.

## Architecture and contract checks

Evaluate these where relevant:

- root objects route and compose rather than own feature-local state
- feature additions primarily touch feature-owned modules, with small registration changes in central paths
- orchestration, domain rules, IO, rendering, and mutation are separated where mixing them raises change risk
- async/background work has a clear owner, result/message shape, cancellation or shutdown path, and state mutation boundary
- render/view functions avoid hidden IO or mutation where the framework permits
- named objects survive until serialization/render boundaries instead of becoming magic indexes, tuples, parallel arrays, or string lists
- reset/cleanup behavior is owned rather than scattered through null, empty, or sentinel assignments
- shared code has a stable owner and does not become a dumping ground
- comments explain invariants, ordering, side effects, or non-obvious ownership rather than restating code

## Scope, documentation, and modernization

- Add documentation only when it reduces future discovery cost. Prefer accurate entry-point maps and local invariant comments over broad prose.
- Do not rewrite user-facing README material unless it is part of the requested hardening scope.
- Treat toolchain, dependency, lint-policy, and runtime changes as opt-in modernization. Explain evidence, benefit, migration cost, and risk before implementation.
- Do not use “agent-friendly” to justify product scope expansion, framework churn, new infrastructure, or unfamiliar dependencies.
- Read `references/dependency-safety.md` before dependency or installer changes.

## Output by task

- **Focused review:** material findings with evidence, impact, and a specific recommendation.
- **Scorecard:** severity-ordered findings, rubric scores with evidence, and the highest-leverage next steps.
- **Plan:** ordered interventions, ownership boundaries, affected files, dependencies between steps, and validation.
- **Implementation:** concise change summary, new ownership/contract shape, checks run, and remaining risks.

Do not emit every format for every task. Match the deliverable to what the user asked for.
