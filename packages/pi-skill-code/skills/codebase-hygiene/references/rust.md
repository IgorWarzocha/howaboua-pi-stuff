Penalize these in central paths and public contracts:

- root modules, state modules, error modules, preludes, or utility modules that absorb unrelated ownership
- broad traits used as abstraction theater without a stable boundary
- primitive soup where IDs, paths, units, validated strings, or external references can be confused
- `Option` hiding a failure reason, or error erasure before callers have made required decisions
- `unwrap`, `expect`, `panic`, or `todo!` in recoverable runtime paths
- feature combinations with unclear ownership or validation
- unsafe code without local invariants and safe wrappers that enforce them
- spawned async work without ownership, cancellation, shutdown, and error propagation
- blocking IO or CPU work hidden inside async execution

Keep crate and module boundaries aligned with ownership and deployment. `lib.rs`, `main.rs`, and module roots should map the system rather than own product logic. Do not split cohesive behavior into tiny modules or crates solely to reduce size.

Use enums for state machines and lifecycle transitions. Use newtypes when they prevent identity or unit confusion, preserve validation, or define a real contract. Do not wrap every primitive without a semantic reason.

Use narrow traits for real polymorphism, external adapters, or stable consumer capabilities. Do not introduce a trait only to mock internal code or imitate object-oriented layering. Preserve meaningful error variants at library and public boundaries, then render user-facing reports at CLI or service edges.

Rust module imports are not runtime loading. Dependency and feature topology affect ownership, compilation, linking, code generation, and binary output. Measure runtime calls, compile time, code size, and dynamic-dispatch cost separately.

Inspect procedural macros, generated dispatch, blanket implementations, feature-selected code, and trait-object boundaries when source imports do not reveal implementation selection. Keep application construction explicit and active implementations visible through a source-level manifest where practical.

Every async task needs an owner for startup, cancellation, shutdown, and error collection. Do not drop meaningful join handles or rely on process exit for cleanup. Account for channel closure, partial writes, locks, temporary resources, and blocking work.

Treat unsafe and FFI as ownership hotspots. Keep safety invariants next to unsafe operations or public unsafe APIs. Safe wrappers must enforce required lifetimes, aliasing, initialization, thread, and drop behavior. Separate generated bindings from domain logic.

Use focused tests where runtime behavior must enforce unsafe contracts, cancellation, and owned lifecycle risk.
