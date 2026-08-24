Treat TypeScript 7 as the required target. An older compiler is migration state, not the desired architecture. Before upgrading, identify framework, editor, declaration, transform, generator, lint, and build tools that import the TypeScript compiler API or rely on removed behavior. Present compatibility work and breakage risk before changing the toolchain.

Do not preserve an older compiler by weakening types or architecture. Do not force a migration through with broad casts, ignores, disabled checks, skipped files, or parallel permanent compiler paths. Fix strictness exposed by TypeScript 7 by owned area. Do not hide it.

Penalize these in central paths and public contracts:

- pervasive `any`, `unknown` immediately cast away, unchecked JSON, double casts, and non-null assertions
- duplicated DTOs across API, server, client, database, queue, and UI boundaries
- flag-bag state with incompatible booleans and optional fields
- primitive confusion between IDs, slugs, paths, emails, external references, and validated values
- positional tuples, string arrays, parallel arrays, and magic indexes flowing through domain logic
- catch-all `utils.ts`, `helpers.ts`, `lib.ts`, `types.ts`, service modules, and barrels with unrelated ownership
- root apps, routes, reducers, stores, and dispatchers that absorb each new feature
- top-level client construction, IO, registration, and mutable setup
- casts, ignore comments, or weaker compiler settings added only to pass checks

Prefer runtime schemas at IO boundaries with static types derived from the same source when practical. Use discriminated unions for lifecycle, async, command, and UI states. Use branded or domain types when values cross ownership boundaries, can be confused, or represent validation that must not be repeated or bypassed.

Keep feature behavior, state, contracts, effects, and tests near one owner. Do not introduce a repository, service, manager, hook, factory, or interface merely because the pattern is common. Each layer must own a contract, policy, effect, lifecycle, implementation choice, or stable reuse.

Keep render functions and components free of hidden IO and mutation where the framework permits. Move state transitions, data shaping, and effects to named owners when that makes the path easier to follow. Do not split a coherent component into wrapper and hook confetti solely to reduce line count.

Inspect emitted runtime behavior before making import-cost claims. Use `import type` when supported and consistent. Treat barrels as problems only when they obscure ownership, create cycles, defeat tree-shaking, or eagerly evaluate broad graphs.

Use dynamic `import()` for measured cold or optional boundaries, not to conceal cycles. Account for chunking, first-use latency, delayed errors, server and client boundaries, packaging, and reduced static traversal.

External provider types are not proof that runtime data matches. Validate the real boundary.
