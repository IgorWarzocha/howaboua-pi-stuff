---
name: adversarial-qa
description: "Adversarial code QA via executable counterexamples. Use for adversarial review passes, patch breaking, edge cases, invariants, differential checks, regression-test validation, mutation testing, or fuzzing."
---

# Adversarial QA

## Operating principles

1. **Falsify, do not reassure.** Ask what observation would disprove the claimed behaviour.
2. **Ground the contract.** Attack behaviour supported by requirements, public documentation, types, callers, existing tests, an independent implementation, or confirmed history. Treat names and intuition as leads, not truth.
3. **Keep the oracle independent.** A test copied from the implementation can only confirm the implementation. Prefer accepted contracts, validated models or references, and contract-grounded algebraic relationships. Mutants test sensitivity, and differential mismatches are leads until the contract classifies them.
4. **Use the smallest decisive method.** Do not run fuzzing, mutation, and property-based testing when one boundary case can settle the question.
5. **Preserve the workspace.** Do not reset, stash, or overwrite unrelated work. Run production mutations only in a disposable worktree or copy, then verify its final source state. Isolate mutable services, databases, ports, caches, and other external side effects. Always discard production mutations; retain only requested tests or harnesses.
6. **Report survival, not correctness.** No found counterexample means the target survived the attacks performed; it is not proof that the target is correct.

## Workflow

### 1. Frame the challenge

- Identify the target: patch, changed symbol, existing behaviour, regression test, or reported bug.
- Inspect repository instructions, git state, the relevant diff or code, nearby tests, and the established validation commands. Record initial tracked, untracked, and relevant ignored generated state before attacks can create debris.
- Infer a proportionate attack depth:
  - **quick:** boundary cases and negative proof for a focused change
  - **focused (default):** one or two high-value properties, differential checks, or local mutants
  - **deep:** stateful generation, fuzzing, failure injection, or several independent methods when risk or the user warrants the cost
- Ask only when the desired behaviour is genuinely ambiguous or a deep run would create material cost or side effects.

### 2. Build a contract matrix

For each material claim, record:

- the positive behaviour that should hold
- important behaviour that must not change
- the source of that claim
- the observable oracle
- a plausible attack

Rank evidence:

- **strong:** explicit acceptance criteria, public contract, validated reference or model, existing compatibility test grounded in a contract, or confirmed historical behaviour when compatibility is intended
- **supporting:** stable caller assumptions, several consistent examples, or independent and sibling implementations
- **speculative:** naming, implementation shape, or model intuition

Use speculative evidence to investigate, but not to declare a bug. If two strong sources conflict, surface the exact product decision instead of inventing an oracle.

### 3. Select the attack

Choose by failure shape:

| Situation | Preferred attack |
|---|---|
| Claimed regression fix | Reproduce before, pass after, then corrupt or revert the fix to prove the regression test detects it |
| Boundaries, parsing, normalization, serialization | Property-based or metamorphic testing with generated valid inputs |
| Refactor, optimization, migration, compatibility change | Differential testing against the baseline or a reference implementation |
| New or suspicious tests | Targeted mutation testing around the behaviour they claim to protect |
| Parsers, decoders, public input surfaces | Coverage-guided or grammar-aware fuzzing when a useful crash/property oracle exists |
| Stateful API or protocol | Generated operation sequences checked against invariants or a simple model |
| Timing, retries, IO, concurrency | Failure injection, reordered operations, fake clocks, controlled scheduling, or repeated stress runs |

Read `references/attack-patterns.md` when selecting an unfamiliar method or toolchain.

### 4. Establish the baseline

- Run the narrow existing check before adding an attack when practical.
- For a claimed fix, reproduce against the known-bad revision in an isolated worktree or equivalent safe checkout when available.
- For refactors, migrations, and compatibility changes, establish the prior revision or reference as a known-good differential baseline.
- Never roll back a dirty user worktree.
- Record exact commands, revision, relevant environment, and observed result.
- If the required baseline cannot be established, continue only when another independent oracle is strong enough, and label the limitation.

### 5. Execute and challenge the test itself

- Generate inputs inside the supported domain. Prefer sound, partly complete generators over broad invalid-input noise.
- Check that assertions are not tautological, exceptions are not swallowed, filters do not discard nearly all inputs, and the test reaches the intended implementation.
- Explore meaningful dimensions and their interactions systematically until a failure appears or the chosen attack budget is exhausted.
- For each failure:
  1. reproduce it independently
  2. shrink it to the smallest useful input or sequence, isolating dimensions during minimization
  3. verify that the harness is not at fault
  4. confirm the input is inside the evidenced contract
  5. assess whether the difference is a bug, intended change, or unspecified behaviour

Do not modify production code merely to make an adversarial test pass unless fixing the discovered problem is in scope.

### 6. Prove retained tests matter

Before keeping a generated regression test:

- show that it fails against the known-bad behaviour, a reverted fix, or a deliberate local mutant representing the bug
- show that it passes against the candidate behaviour
- restore every temporary mutation
- run the relevant surrounding suite
- compare final tracked, untracked, and relevant ignored generated state with the recorded initial state; remove only newly generated debris
- inspect the final diff for weakened assertions, snapshots, or accidental dependency changes

Prefer retaining one readable regression example plus a strong general property. Do not commit large generated corpora unless the repository already owns them intentionally.

### 7. Reach a bounded verdict

Use one of these verdicts:

- **Broken:** a contract-supported, reproducible counterexample exists.
- **Survived:** no counterexample was found within the stated attacks and scope.
- **Ambiguous:** observed behaviour conflicts with an incomplete or contradictory contract.
- **Blocked:** the necessary baseline, environment, or oracle could not be established.

Stop when the verdict is supported, further attacks would repeat the same evidence, or the remaining method would be disproportionate to the risk.

## Output

Report concisely:

1. target and contract challenged
2. attack methods and scope
3. verdict
4. minimal counterexample or strongest surviving evidence
5. commands and revisions used
6. retained tests or changed files
7. untested dimensions and specification ambiguities

Lead with a runnable reproducer when the target is broken. Never bury a real counterexample beneath a generic review summary.

## Recovery

- **No strong contract:** inspect callers, documentation, history, and reference implementations; if the oracle remains subjective, return `Ambiguous`.
- **Generated failures are mostly invalid inputs:** tighten the generator to the supported domain rather than adding production guards automatically.
- **Property passes trivially:** mutate the relevant behaviour or inspect generated examples to establish that the property can fail.
- **Flaky counterexample:** control time, randomness, scheduling, environment, and seed; report it as flaky rather than deterministic if it cannot be stabilized.
- **Tool unavailable:** use the nearest repository-native method or return `Blocked`; do not add a lasting dependency without an accepted need.
