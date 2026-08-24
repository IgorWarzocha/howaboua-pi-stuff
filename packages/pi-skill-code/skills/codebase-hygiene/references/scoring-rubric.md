Scores summarize evidence. They are not objective measurements. State the inspected scope, cite evidence, and use `not assessed` when evidence is missing. Explain every score and any cap. Do not inflate a score because code is typed, tested, or formatted while central ownership remains unsafe.

## 1. Structure and ownership

- **0 to 2:** Central godfiles, competing owners, catch-all modules, and changes routinely cross unrelated concerns.
- **3 to 5:** Some ownership exists, but actively growing hotspots and unstable shared modules still dominate common changes.
- **6 to 8:** Responsibilities have clear owners, local changes stay local, and shared behavior has stable contracts.
- **9 to 10:** Ownership is obvious, append bias is resisted, duplication and reuse match semantic stability, and consequential changes have low reassessment cost.

## 2. Contract and state safety

- **0 to 2:** External data is unchecked, state is ambiguous, positional or stringly typed data is pervasive, and contracts drift.
- **3 to 5:** Major data structures exist, but unsafe conversions, duplicated contracts, flag bags, or primitive confusion remain in important paths.
- **6 to 8:** Boundaries validate data, state variants and domain types protect major invariants, and unsafe edges are contained.
- **9 to 10:** Invalid states are modeled out where practical, contract sources of truth are clear, and domain meaning survives end to end.

## 3. Traversability

- **0 to 2:** Execution disappears into godfiles, generic dispatch, hidden registration, callback tunnels, import effects, or broad search archaeology.
- **3 to 5:** Happy paths can be reconstructed, but no-value frames, dynamic edges, or oversized owners require substantial rereading.
- **6 to 8:** Entry points, owners, calls, continuations, and imports are mostly discoverable with limited no-value indirection.
- **9 to 10:** Reading each step reveals the next meaningful step and its owner. Runtime selection and initialization are deliberate and inspectable.

## 4. Lifecycle and effects

- **0 to 2:** Effects, tasks, resources, retries, cancellation, and cleanup have no reliable owner.
- **3 to 5:** Normal paths work, but failure, partial startup, shutdown, or concurrent mutation remains ambiguous.
- **6 to 8:** Important resources and background work have explicit ownership, bounded behavior, failure propagation, and cleanup.
- **9 to 10:** Lifecycle is explicit across success, failure, cancellation, retry, and shutdown, with one state-mutation owner and focused verification.

## 5. Test fit

- **0 to 2:** Consequential owned contracts are unprotected, or the suite is dominated by flaky, fictional, or meaningless tests.
- **3 to 5:** Some useful tests exist, but provider simulations, typecheck duplication, feature-existence assertions, UI churn, or mock coupling consume substantial effort.
- **6 to 8:** Deterministic tests protect important owned contracts, state transitions, and failure paths without broad scaffolding.
- **9 to 10:** A small, high-signal suite finds real failures, rejects regression mechanisms, and avoids test theater. Volume does not affect the score.

## 6. Feedback loops

- **0 to 2:** No reliable validation path exists.
- **3 to 5:** Useful checks exist but are fragmented, slow, flaky, or easy to bypass.
- **6 to 8:** Relevant type, contract, test, lint, and build checks are reliable and discoverable.
- **9 to 10:** Fast local checks and enforced aggregate gates catch consequential failures without weakening policy or generating maintenance theater.

## Calibration caps

Apply these only when the problem is material to the inspected scope:

- An actively maintained file above roughly 300 lines that mixes several core responsibilities usually caps **Structure and ownership** and **Traversability** at 5.
- A central function mixing orchestration, domain rules, IO, mutation, and error policy usually caps those categories at 6.
- Runtime paths dominated by hidden selection, no-value frames, or import-time behavior usually cap **Traversability** at 5.
- A shared module whose changes require reassessing many semantically different consumers usually caps **Structure and ownership** at 5.
- Unowned background work, cancellation, or cleanup in a central path usually caps **Lifecycle and effects** at 4.
- A large suite dominated by feature-existence tests, provider fiction, typecheck duplication, snapshots, or mock choreography usually caps **Test fit** at 5 regardless of coverage.

Adjust for generated or framework-owned code, repository size, actual change frequency, and whether the hotspot is central or isolated. Evidence decides what must change.
