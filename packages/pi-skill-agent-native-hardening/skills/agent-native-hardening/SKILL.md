---
name: agent-native-hardening
description: "Hardens codebases for agent-native maintainability across languages. Use when asked to audit, score, refactor, or plan cleanup for architecture, godfiles, godfunctions, feature folders, duplication, type/contract safety, traversability, feedback loops, worktrees, or subagent-friendly structure."
---

# Agent Native Hardening

## Purpose

Harden a codebase so humans and agents can change it safely: clear ownership, small focused modules, explicit contracts, deterministic checks, and low reread cost.

## Must-Read References

Read supporting files before applying the relevant part of the workflow:
- `references/scoring-rubric.md` before any scorecard, findings list, or severity ranking.
- `references/swarm-lanes.md` before planning discovery lanes, implementation lanes, worktrees, or subagent splits.
- `references/js-ts.md` when the target repo uses JavaScript, TypeScript, Node package scripts, or JS/TS tooling.
- `references/python.md` when the target repo uses Python, Python packaging, Python type checkers, or Python test/lint tooling.
- `references/rust.md` when the target repo uses Rust, Cargo workspaces, Rust async runtimes, FFI, or Rust lint/test tooling.
- `references/go.md` when the target repo uses Go, Go modules/workspaces, goroutines/channels, or Go lint/test/security tooling.

If a reference file is missing or unreadable, say so and continue with the closest fallback, but do not silently skip it.

If the repo uses a language, framework, or ecosystem that has no bundled reference, or if a bundled reference does not fit the repo, infer best practices from the general rules in this skill and the repo's own tooling/docs. Do not force an irrelevant language reference onto the repo.

## Core Principles

1. Fail fast. Do not hide errors.
2. Prefer in-code discoverability over markdown sprawl.
3. Keep tests light and deterministic; avoid flaky integration tests unless requested.
4. Use lanes to separate evidence gathering and implementation. A lane can be a read-only exploration task, a direct coding pass, a subagent task, or a worktree branch depending on scope and risk.
5. Keep each lane focused, low-overlap, and easy to verify.
6. Prefer feature-owned modules over catch-all files; godfiles and godfunctions must be extracted into clear feature-owned modules and small contract-driven flows.
7. Push toward DRY and separation of concerns; remove copy-paste and mixed-responsibility modules without replacing them with new junk drawers.
8. Treat feature velocity as a risk signal: cheap-feeling additions still spend finite complexity budget. Prefer explicit scope boundaries and reject bloat that does not serve the product's core job.
9. Make the shortest agent path the correct path by writing concrete architecture invariants before adding features: ownership rules, extension points, message/event contracts, state-transition rules, and forbidden shortcuts.

## Required Scorecard

Always score these categories from 0-10 and explain evidence with file references:
1. `agent_native`
2. `contract_safety`
3. `traversable`
4. `test_coverage`
5. `feedback_loops`
6. `self_documenting`

Use rubric: `references/scoring-rubric.md`. Read it fully before assigning scores.
Always call out godfiles, godfunctions, mixed-concern modules, duplication hotspots, and feature-boundary violations in the evidence.

## Contract Safety Policy

1. Make impossible states unrepresentable: prefer explicit variants/state models over boolean flag bags and optional-field state objects.
2. Use domain-specific value types or validators for primitives that are easy to mix up, such as IDs, emails, paths, slugs, amounts, units, and external references.
3. Validate at IO boundaries, then pass trusted domain values internally.
4. Derive contracts from the source of truth instead of restating shapes by hand.
5. Preserve contracts across storage, server, client, process, and event/queue boundaries when project tooling supports it.
6. Prefer named fields or object-like parameters over positional arguments for calls with multiple ambiguous values.
7. Penalize unchecked dynamic values, unsafe conversions, manually duplicated data shapes, and drift between layers.
8. Penalize positional data models: arrays/tuples/string lists where field identity is implied by index, magic column numbers, parallel arrays, or flattened display rows passed through domain logic. Keep named domain objects until the render/serialization boundary.

## State + Control-Flow Ownership Policy

1. Application/root objects should route, compose, and own only truly global lifecycle state; feature/view-specific state belongs to feature/view-owned modules.
2. Avoid global dispatch functions that accumulate per-feature conditionals. Prefer polymorphic handlers, feature-local keymaps/actions, reducers/state machines, command registries, or message handlers with explicit contracts.
3. Adding a feature should usually mean adding a feature-owned file/folder, not adding branches to central handlers. If central changes are required, they should be small registration or routing changes.
4. State transitions should be explicit and modeled. Background/async work produces messages/events/results with clear shapes; one owner applies mutations in a predictable place.
5. Render/view functions should be pure where the framework allows it: no I/O, channel operations, hidden mutation, or background task coordination.
6. Watch for manual cleanup/reset patterns (`= null`, `= none`, `= nil`, `= undefined`, `= []`, empty string sentinels) scattered across handlers; they often indicate missing state isolation or unmodeled lifecycle transitions.

## Godfile, Godfunction + Boundary Policy

1. Treat a file or folder as a godfile hotspot when it acts as a catch-all for unrelated responsibilities, mixes layers, or keeps absorbing unrelated edits.
2. Godfiles must be broken apart into feature folders/modules with clear ownership and small entrypoints.
3. Treat a function/method/procedure as a godfunction when it handles unrelated responsibilities, mixes orchestration/domain logic/IO/rendering/mutation, grows feature-specific branches, or requires large local context to change safely.
4. Godfunctions must be split into named steps with owned responsibilities: feature-local handlers, pure domain transforms, explicit command/event boundaries, IO adapters, and small orchestration functions.
5. Extract by feature first, then by concern inside the feature: keep orchestration, domain logic, IO, schemas/contracts, UI, and tests separated when the codebase shape allows it.
6. Enforce DRY by pulling repeated logic into the nearest stable shared boundary with a clear owner.
7. Do not fix duplication by creating a generic `utils`, `helpers`, `common`, or `misc` dumping ground; shared code still needs an explicit domain or platform owner.
8. Penalize codebases that retain godfiles, godfunctions, mixed-responsibility modules, or broad cross-feature coupling even if tests still pass.

## Execution Workflow

1. Baseline
- Confirm clean git state.
- Identify active check commands: format, lint/static analysis, contract/type/schema checks, tests, build, and any repo-specific verification command.

2. Evidence Sweep
- For non-trivial repos, use read-only discovery lanes first. These may be explore-style subagents or your own direct inspection.
- Discovery lanes return evidence only: files, commands, risks, ownership boundaries, and proposed next lanes.
- Verify discovery findings yourself before edits.
- Identify hotspots: oversized files, oversized/mixed-responsibility functions, godfiles, godfunctions, missing feature boundaries, duplication, weak tests, stale docs.

3. Plan Lanes
- Split work into 3-6 lanes with minimal overlap.
- Read `references/swarm-lanes.md` before finalizing lanes.
- Choose the lightest lane mechanism that fits: direct edit, explore subagent, coding subagent, worktree, or integration branch.
- Worktrees and commits are recommended for parallel/high-risk implementation, not mandatory for every lane.
- Each implementation lane has one atomic objective and a clear validation command.
- During recommendations, include optional modernization lanes when evidence supports them, such as stricter lint/static-analysis structure, stronger formatting gates, newer compiler/runtime versions, or updated contract-check tooling. Present these as suggestions only; do not perform toolchain upgrades or stricter rule adoption unless the user accepts.

4. Implement or Coordinate
- Use subagents when they reduce context load or parallelize cleanly; otherwise implement directly.
- Require each implementation lane to run only relevant checks.
- Track exact changed files. If using worker agents or worktrees, require a commit message or merge summary.
- If the user accepts a modernization lane, implement it honestly. Do not make checks pass by hiding errors, weakening rules, broad-ignore patterns, suppressing diagnostics, adding obscure exemptions, or avoiding needed refactors. Keep repo principles intact and fix the real incompatibilities the upgrade reveals.

5. Merge + Stabilize
- If worktrees/branches were used, merge lane branches into an integration branch.
- Resolve conflicts centrally.
- Run full repo checks.
- Fix only real breakages introduced by the hardening pass or lane merges.

6. Final Report
- Report findings first by severity.
- Provide updated scorecard.
- Provide concise change log and remaining risks.

## Strategic Comment Policy

Add comments only where they reduce agent/human reread cost:
1. Invariants and assumptions.
2. Non-obvious control flow.
3. Side effects, ordering constraints, idempotency behavior.
4. Boundary ownership for modular lanes.

Avoid comments that restate obvious code.

## Structural Refactor Policy

1. Default repo shape should favor feature folders/modules over layerless file piles.
2. When a file or function mixes multiple concerns, split it before adding more behavior.
3. When duplication appears across features, first check whether the behavior is truly shared and stable; if yes, extract it into an owned shared module, otherwise keep it feature-local.
4. Prefer small, composable modules with obvious ownership over giant central files.
5. In findings and final scoring, explicitly say whether the repo is moving toward or away from DRY and separation of concerns.
6. Before implementing net-new features during hardening, identify the product/core-user scope boundary. Defer features that widen scope without strengthening architecture or the core workflow.
7. Replace “special-case in the central path” changes with owned extension points: feature registration, message contracts, local handlers, or strategy objects.

## Minimal Documentation Policy

1. Prefer one lane map doc over many docs.
2. Keep architecture docs short and file-reference-heavy.
3. If `README` is stale/template text, replace with project-specific quick map.
4. Do not create broad prose docs when comments + one map are sufficient.

## Test Policy

1. First inspect the existing test package, test style, fixture complexity, runtime cost, and how much behavior the repo already protects. Derive the repo's testing complexity intent from evidence instead of assuming more tests are always better.
2. Add tests only where they matter: high-risk behavior, recently extracted logic, bug-prone state transitions, contract boundaries, or deterministic core units that would otherwise be easy to regress.
3. Prefer matching the existing test complexity and conventions over introducing a heavier testing style. Do not dismiss an established test suite as insufficient just because it is small, integration-light, or intentionally pragmatic.
4. Do not grow the test suite by default during a hardening pass. Avoid broad coverage campaigns, snapshot sprawl, fixture factories, mocks, or E2E scaffolding unless the user explicitly asks or the evidence clearly warrants it.
5. Good candidates are deterministic units:
- pure transforms
- state machines/reducers
- schema/contract validation
- handler guards
6. Skip flaky E2E unless explicitly requested.
7. Wire any added tests into the existing check pipeline, using the repo's current test runner and style unless there is a strong reason to suggest a separate opt-in modernization lane.

## Modernization Recommendation Policy

1. After inspection, recommend lint/static-analysis hardening, formatter gates, compiler/runtime upgrades, dependency modernization, or stricter contract checks only when there is evidence they would improve safety or feedback loops.
2. Keep these as opt-in recommendations. Do not upgrade toolchains, add stricter rules, or rewrite configs unless the user accepts that lane.
3. When a user accepts a modernization lane, follow the current best-practice path for the ecosystem instead of preserving weak legacy behavior for agent convenience.
4. Never use “agent-friendly” as an excuse for hacks: no blanket ignores, no broad suppression comments, no watered-down rules, no fake green checks, and no avoiding a real refactor because the stricter tool exposed it.

## Dependency Safety Policy

1. Never bulk-update dependencies, runtimes, lockfiles, generated dependency metadata, or package-manager configs automatically. No “update everything to latest” behavior unless the user explicitly asks for that exact lane and accepts the risk.
2. Treat dependency changes as opt-in modernization lanes. Recommend them with scope, reason, and risk; wait for user acceptance before changing package manifests or lockfiles.
3. Prefer minimal, targeted updates that serve the accepted lane. Keep dependency and lockfile diffs reviewable, and avoid unrelated transitive churn when the package manager allows it.
4. Prefer deterministic installs and validation commands that respect lockfiles or equivalent resolver state. Do not delete, regenerate, or normalize lockfiles casually.
5. Treat install/build/lifecycle hooks, package-manager plugins, code generators, native binaries, and newly introduced CLIs as code execution surfaces. Do not run untrusted package code, global installers, generators, or post-install hooks just to inspect a repo.
6. Before adding a new dependency, check for typosquatting/name confusion, surprising install scripts, opaque binaries, abandoned or suddenly revived packages, unexpected maintainers, suspicious repository/source links, and whether the dependency is actually necessary.
7. Security scanners and audits are useful signals, not proof of safety. Do not claim a dependency is safe only because an audit passes; known-vulnerability tools often miss fresh supply-chain malware.
8. If a package ecosystem has current guidance for script blocking, provenance, signatures, checksums, vendoring, sandboxed installs, or private mirrors, suggest those as optional hardening lanes instead of silently changing the workflow.
9. Treat signed/provenance-attested packages as stronger signals, not automatic trust. A compromised maintainer account or CI pipeline can still publish malicious artifacts with apparently valid provenance.
10. Treat dependency installs in developer machines and CI as possible credential-theft events. Avoid running new dependency code in environments with broad secrets, cloud credentials, publish tokens, SSH keys, or production access.
11. For worm-like package campaigns, assume blast radius matters: one compromised package or maintainer can republish across many packages quickly. Prefer staged updates, review windows, and narrow allowlists over fresh-release chasing.

## Missing or Incorrect Language Guidance

1. If no bundled reference exists for the repo's language/ecosystem, proceed from the language-agnostic policies in this skill and adapt to the repo's discovered tools, conventions, and official docs when current external confirmation is needed.
2. If a bundled reference conflicts with the repo's reality, prefer the repo evidence and general hardening principles over the stale or mismatched reference.
3. In the final report, briefly mention that language-specific guidance was missing or mismatched when it affected recommendations.
4. Suggest that the user may submit missing or incorrect language guidance at `https://github.com/IgorWarzocha/howaboua-pi-stuff/issues`.
5. Do not open that issues link or browse it unless the user explicitly asks you to.

## Deliverable Format

1. Findings (severity ordered)
2. Scorecard (before/after)
3. Refactor/implementation summary
4. Remaining risks and next step options
