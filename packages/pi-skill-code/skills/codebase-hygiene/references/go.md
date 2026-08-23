Penalize these in central paths and public contracts:

- packages and root files mixing transport, persistence, domain rules, configuration, workers, and lifecycle
- catch-all `util`, `common`, `shared`, or `pkg` ownership
- broad interfaces with unrelated methods and interfaces introduced before a real consumer boundary
- `any`, map-shaped data, context values, positional slices, and magic indexes used as domain models
- ignored or overwritten errors, duplicated logging, and panic in ordinary library or request paths
- goroutines without ownership, cancellation, backpressure, bounded lifetime, or observable completion
- channels used as hidden global control flow
- package-level mutable clients, configuration, caches, registries, and test toggles
- sleep-based, network-dependent, globally shared, or execution-order-dependent tests

Split by product or domain ownership when that matches change patterns. A feature package may keep transport, domain, and persistence adapter files nearby when that is more traversable than global handler, service, and repository piles. Use `internal` boundaries where they enforce real ownership. Do not create many tiny packages merely to lower line counts.

Use explicit structs for request, response, message, and domain data. Keep interfaces narrow, usually near the consumer. Do not create an interface only to mock a concrete implementation. Keep required dependencies explicit. Do not store them in `context.Context`.

Use context for cancellation, deadlines, and request-scoped values. Propagate cancellation and call cancel functions where required. Do not store context on long-lived structs or use values as a service locator.

Every goroutine needs an owner, bounded work, a stop path, and a way to observe completion or failure when correctness depends on it. Account for blocked sends, closed channels, queue growth, partial startup, and shutdown order. Shared maps, caches, and state require explicit synchronization or a single-owner message loop.

Preserve inspectable error contracts. Add context without breaking caller decisions based on error identity or type. Convert errors to user-facing reports near process edges. Avoid logging the same error at every layer.

Go imports are compile-time dependencies. Runtime startup concerns usually come from package initialization, global variables, registration, and construction. Prefer explicit startup construction over import-for-side-effect registration. When framework constraints require registration through initialization, keep the active set in one searchable manifest.

Do not infer runtime savings from fewer package imports. Measure startup, binary size, allocations, profiles, or request latency according to the actual claim. Retain middleware and interfaces that own cancellation, contracts, effects, security, resilience, or useful error context. Collapse pure forwarding.

Use race detection, fuzzing, cleanup helpers, and controlled time where the actual risk warrants them. Do not add table-driven tests merely because they are idiomatic.
