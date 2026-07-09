# Work Lane Guide

Use lanes to make broad work legible, not to force every task into multi-agent orchestration. A lane is an independently understandable objective with its own evidence or validation.

Choose the lightest mechanism that preserves safety:

1. **Direct pass:** one agent handles a coherent scope in the current workspace.
2. **Discovery lane:** read-only investigation of a bounded area. It may be done directly or delegated when the area is broad and separable.
3. **Implementation lane:** a bounded change with one owner and clear validation. Use a branch or worktree only when isolation or parallel edits materially help.
4. **Stabilization lane:** integration, conflict resolution, affected checks, and fixes caused by previous lanes.

Do not create lanes merely to reach a target count. Avoid overlapping ownership, repeated discovery, and delegation where each result would immediately change the next judgment.

## Discovery lane patterns

### Repo map and commands

- Scope: package/workspace layout, entry points, scripts, test runners, lint/format/type/build tooling
- Result: relevant command list, ownership map, and unclear boundaries

### Hotspots and centralization

- Scope: mixed-responsibility files/functions, catch-all folders, root controllers, dispatchers, registries, high fan-in/fan-out modules
- Result: ranked hotspots with concrete change risk and likely owner boundaries

### Contracts and state

- Scope: duplicated shapes, unchecked dynamic values, flag bags, primitive soup, positional data, manual resets, lifecycle ambiguity
- Result: candidate source-of-truth contracts, state variants, validators, or owned transitions

### Duplication and feature boundaries

- Scope: repeated logic, cross-feature imports, broad shared modules, repeated central-path edits
- Result: keep-local versus extract recommendation and the proposed stable owner

### Feedback loops

- Scope: active local/CI checks, runtime cost, flaky paths, package coverage, generated artifacts
- Result: checks appropriate to the planned changes and any material gaps

## Implementation lane patterns

### Owned hotspot extraction

- Objective: split one mixed-responsibility hotspot into feature-owned modules
- Guardrail: preserve behavior and avoid creating tiny pass-through fragments
- Validation: affected unit/contract checks plus the repo's relevant aggregate command

### Contract or state hardening

- Objective: replace duplicated/implicit shapes or ambiguous state with an explicit owner and model
- Guardrail: validate at IO boundaries and avoid parallel old/new contracts
- Validation: boundary parsing, state transitions, callers, and type/schema checks

### Feedback-loop repair

- Objective: make existing checks reliable, discoverable, and appropriately scoped
- Guardrail: do not weaken policy or invent a broad test campaign
- Validation: the repaired command fails on a known bad state and passes on the corrected one where practical

### Discoverability

- Objective: expose entry points, invariants, or ownership that structure alone cannot communicate
- Guardrail: prefer local comments or one concise existing map over new documentation sprawl
- Validation: links/paths resolve and the guidance matches the final code

### Runtime or lifecycle hardening

- Objective: clarify process, task, resource, cancellation, shutdown, and failure ownership
- Guardrail: preserve observable behavior unless change is accepted
- Validation: consequential success, failure, cancellation, and cleanup paths

## Lane contract

For each non-trivial lane, record:

- objective and boundaries
- relevant files or subsystem
- evidence or expected change
- dependencies on other lanes
- validation command
- completion result or remaining blocker

When using subagents, branches, or worktrees, require the same contract. Integrate results centrally and verify claims before editing or merging.
