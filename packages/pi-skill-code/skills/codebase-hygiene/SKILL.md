---
name: codebase-hygiene
description: "Must always apply when working on maintained code."
last-changed: "2026-08-30"
---

## Load applicable rules

Loaded references are authoritative.

- Structural movement, ownership migration, and compatibility cleanup: `references/refactoring.md`
- Test assessment, addition, deletion, and scoring: `references/testing.md`
- Calls, dispatch, callbacks, continuations, imports, initialization, startup, and runtime cost: `references/execution-topology.md`
- Dependencies, lockfiles, installers, scripts, CI actions, runtimes, compilers, and third-party tools: `references/dependency-safety.md`
- Load every reference matching a repository language: `references/js-ts.md`, `references/python.md`, `references/go.md`, `references/rust.md`
- React components, Hooks, rendering, state, and framework boundaries: `references/react.md`
- For other languages, use repository evidence and current official ecosystem documentation.
- Scores and caps: `references/scoring-rubric.md`. Score only when requested or already required.

Goal: leave a codebase that another agent can navigate efficiently, change coherently, verify quickly, and explain to a human from the code itself.

## Inspect before editing

Optimize for agents working through search, bounded reads, and coherent multi-file edits. Do not imitate one-file-at-a-time human editing.

Read governing instructions, owning files, consumers, contracts, tests, active checks, runtime edges, and generated or framework-owned areas. Read every file you will change in full, continuing through tool chunks when needed. Search confirms callers and edges but does not replace understanding the owner.

## Shape ownership

1. Resist append bias. Before adding a branch, field, handler, test, or helper, decide whether it strengthens the current owner or reveals another responsibility.
2. Exclude generated, vendored, and framework-owned files from size judgment unless maintained directly.
3. Treat a maintained file above roughly 300 lines as a godfile candidate, not an automatic failure. Inspect mixed concerns, unrelated change reasons, central-path growth, hidden state, and agent readability. Cohesive stable tables, protocols, and algorithms may remain large. Growing mixed-responsibility files may not.
4. Treat a function above roughly 50 lines as a review candidate. Split across ownership, abstraction level, state transition, effect, or failure-policy boundaries. Keep coherent algorithms and state machines together when extraction hides ordering.
5. Collapse one-use helpers, wrapper factories, interfaces, and microfiles that add navigation without owning a decision, contract, translation, effect, lifecycle, resilience, security, or diagnostic boundary.

Dependency topology:

- Minimize unrelated change spread, not raw fan-in or fan-out.
- Tolerate local duplication while semantics are unsettled.
- Consolidate only behavior with the same invariant, change pattern, and stable owner.
- Allow high fan-in for small stable contracts whose implementation changes do not require consumer reassessment.
- Keep high fan-out in explicit composition roots or orchestrators with visible dependencies, order, and failure policy.
- Reject catch-all `utils`, `helpers`, `common`, `types`, managers, services, and contexts with unrelated ownership.

## Keep execution traversable

- Reading a symbol and its imports should reveal the next meaningful step and owner.
- Preserve feature terminology through handlers, state, errors, logs, and tests.
- Keep runtime selection statically enumerable where practical.
- Add registries, events, middleware, factories, interfaces, and indirection only when the hop owns something consequential.
- Keep import direction separate from execution direction. Stable policy must not import volatile infrastructure. Infrastructure may call policy or implement a policy-owned capability.
- Construct dependencies at visible composition points.
- Treat decorators, plugin registration, generated bindings, reflection, callbacks, queues, async continuations, and import-time setup as real edges that must remain discoverable.

## Make contracts and state explicit

- Validate external data at the boundary. Keep named data internally.
- Use domain or branded types where values cross owners, can be confused, or represent completed validation.
- Model exclusive states with variants or enums, not flag bags and optional-field combinations.
- Preserve named fields until serialization or rendering. Avoid magic indexes, parallel arrays, positional tuples, and string-keyed domain dispatch.
- Give each invariant, mutable transition, cache, transaction, and external effect one authority.
- Do not hide dependencies in broad contexts, service locators, global registries, or ambient state.
- Keep public interfaces narrow and in consumer-domain language. Never create an interface only for mocking.

## Own behavior and proof

- The owner that starts a resource, task, timer, subscription, worker, or connection owns failure propagation, cancellation, cleanup, and shutdown. Cover partial startup, blocked work, retries, backpressure, and idempotent cleanup. Background work must not outlive its state or dependencies.
- Tests must reject credible failures in project-owned contracts, invariants, transitions, failure handling, and lifecycle. Do not reward volume, duplicate static checks, invent external providers, or retain feature-existence tests.
- Preserve external behavior unless the user accepts a change. Internal types and layout may change when owned consumers migrate coherently. Public APIs, endpoints, serialized formats, persisted data, configuration, errors, and operational signals are contracts. Make migrations explicit.
- Keep failures visible. Never pass checks through weaker strictness, broad ignores, unsafe casts, swallowed errors, skipped files, deleted useful tests, or silent fallback.
- Treat dependency, runtime, compiler, package-manager, and policy upgrades as separate modernization. Investigate compatibility and migration risk before changing them.
- Comments explain invariants, ordering, effects, compatibility, and non-obvious ownership. Delete code narration and unenforceable claims. Add documentation only when it reduces future discovery.

## Finish

Run checks that exercise the changed contracts and risks. Re-read ownership and execution paths. Search for stale imports, registrations, adapters, duplicate owners, and old implementations. Report checks run, unavailable checks, and remaining material risk.
