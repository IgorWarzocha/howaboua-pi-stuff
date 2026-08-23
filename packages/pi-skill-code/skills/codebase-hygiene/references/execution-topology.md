Assess semantic traversability and runtime cost separately.

- **Semantic traversability:** Can an agent discover, follow, modify, and debug the path without broad repository archaeology?
- **Runtime cost:** What measured call, dispatch, import, initialization, startup, bundle, allocation, or latency cost does the path impose?

A path can be clear and expensive or fast and opaque. Architectural preference is not performance evidence.

Start from one concrete behavior or startup path. Trace:

- synchronous calls from entry to result or effect
- implementation selection, registries, dependency injection, decorators, middleware, callbacks, generated bindings, reflection, and string-keyed dispatch
- explicit continuations after task, event, queue, process, or network boundaries
- error propagation, wrapping, retry, fallback, cancellation, and cleanup
- imports and module initialization triggered by the path
- callers, bypasses, tests, traces, profiles, bundle reports, or startup measurements that establish the claim

A frame earns its place when it owns a domain decision, state transition, validation, translation, effect, transaction, implementation selection, lifecycle, resilience, authorization, or useful diagnostic context. Suspect frames that rename an operation, forward unchanged arguments, unpack and repack the same data, retrieve ambient dependencies, or split one readable operation into one-use fragments.

Several calls can remain clearer than one dense function. Optimize meaningful hops, not stack depth. Before collapsing a frame, inspect public compatibility, callers, overrides, generated use, failure behavior, observability, and lifecycle. Before adding a frame, state what it owns.

Prefer paths where reading `x` explains why `y` is selected and where `z` owns it. Feature terminology should survive through handlers, operations, state, errors, logs, and tests. Registries and plugin tables should have one typed or statically enumerable manifest. Configuration should select implementations at a visible composition boundary.

Friction signals include callback tunnels, wrapper factories, broad service locators, import-time self-registration, decorators that hide business behavior, reflection without a manifest, middleware-order policy, event chains used as local calls, and parallel old and new paths.

Import cost depends on the runtime and toolchain. Establish whether imports are interpreted, compiled, bundled, tree-shaken, cached, or executed for effects. Inspect top-level IO, client construction, registration, mutable setup, cycles, broad re-exports, and eager optional work.

Use lazy loading only for measured cold or optional work. Account for first-use latency, delayed failure, packaging, and reduced static navigation. Do not use dynamic imports or local imports as generic cycle workarounds.

Measure the metric that matters with comparable workloads. One noisy run is not evidence. After a topology change, trace the path again and verify behavior, active callers, error provenance, lifecycle, and the relevant runtime metric.
