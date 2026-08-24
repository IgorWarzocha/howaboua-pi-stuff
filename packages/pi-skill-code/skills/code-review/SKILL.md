---
name: code-review
description: "Must apply when reviewing or accepting maintained-code changes."
last-changed: "2026-08-22"
---

Load an applicable codebase hygiene skill and apply it throughout.

Judge two concerns independently:

- **Intent and correctness:** the requested behavior is complete, with no unrequested behavior or regression.
- **Codebase hygiene:** ownership, contracts, execution, lifecycle, tests, and file boundaries remain coherent.

Never let one concern excuse failure in the other. Treat implementation, tests, comments, types, and documentation produced from the same premise as one evidence source. Agreement within the patch is not independent proof.

## 1. Establish scope

1. Resolve the intended base. Inspect the full diff and commit range, not only the last commit.
2. Read the request, acceptance criteria, complete changed files, affected callers, public contracts, tests, configuration, and runtime registration.
3. Trace changed behavior from a real entry point to its result or effect. Confirm tests reach the production path.
4. Record claimed behavior, missing or partial requirements, unrequested scope, and behavior that must remain stable.
5. Separate observed requirements, compatibility assumptions, and reviewer inference. Ask only when the distinction changes the verdict.

## 2. Establish evidence

Prefer:

1. explicit acceptance criteria and confirmed product decisions
2. public compatibility contracts, persisted formats, protocols, and observed external behavior
3. stable prior behavior when compatibility is required
4. independent callers or implementations with matching semantics
5. tests, comments, names, and implementation structure

Identify the one or two facts the change relies on for safety, including facts beyond direct callers. Prove each with source evidence, an unreachable failure path, an executable check, or the running artifact. Mark unproved claims as unproved.

## 3. Challenge each material claim

Choose the cheapest decisive falsifier:

- **Regression:** reproduce the failure or exact old path. Confirm the cause is removed rather than hidden by a guard, retry, fallback, or catch.
- **Boundary logic:** probe supported transitions around empty, singleton, first, last, missing, duplicate, zero, limits, and ordering.
- **Refactor or optimization:** compare observable behavior before and after on representative supported inputs. Judge differences against the contract.
- **State or lifecycle:** probe illegal order, repetition, partial failure, cancellation, retry exhaustion, cleanup, shutdown, and ownership transfer.
- **Serialization or compatibility:** round-trip real supported data. Inspect old readers, writers, stored data, and version boundaries.
- **Test:** name a plausible wrong implementation the test rejects. For regressions, demonstrate fail-before and pass-after when practical. Registration, rendering, symbol existence, type validity, and mock choreography are not evidence.
- **External integration:** verify the project-owned boundary. Use controlled real-provider evidence when compatibility itself matters. A hand-built double cannot prove an external API.

Use concrete inputs, callers, and local comparisons before fuzzing, mutation campaigns, property frameworks, generated corpora, new dependencies, or elaborate harnesses. Existing machinery earns use only when it supplies a real oracle at proportionate cost.

Challenge the proof:

- Assertions can fail and reach changed production behavior.
- Fixtures inhabit the supported contract rather than invented data.
- Filters, catches, retries, and fallbacks do not hide failure.
- Types and schemas are not mistaken for runtime proof.
- No broad ignore, unsafe cast, skipped file, weakened assertion, silent fallback, deleted useful test, or compatibility wrapper exists only to pass checks.
- No old implementation, bypass, duplicate registration, or unmigrated consumer remains.
- A green suite proves only what that suite tested.

## 4. Report

Report a finding only when a requirement or compatibility contract supports a reproducible failure, or hygiene evidence shows concrete risk from ownership, hidden behavior, lifecycle, verification, or navigation.

Each finding needs:

- severity and specific title
- primary file and symbol
- violated requirement, contract, repository rule, or hygiene principle
- trigger and execution path
- concrete consequence
- independent evidence or minimal reproducer
- smallest credible correction

Rank severity by consequence and realistic reach. Group symptoms under one cause. Reject speculative edge cases, generic best practices, style preferences, and demands for tests without a protected failure.

Lead with findings and put the strongest evidence under each. Then report checks and material residual risk. If none survive, say no material finding was established within the inspected paths and challenges. Never call the change correct.

Stay read-only during review-only work. Stop when each material claim faced a decisive challenge, further checks repeat existing evidence, or remaining uncertainty requires a product decision or unavailable external system.
