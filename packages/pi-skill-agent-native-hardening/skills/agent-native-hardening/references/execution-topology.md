# Execution Topology

Use this lens when the hardening task involves runtime navigation or cost. It is heuristic, not a prescribed layer model or maximum stack depth.

## Separate the two claims

Assess these independently:

- **Semantic efficiency:** how easily an agent can discover, follow, modify, and debug the execution path.
- **Runtime efficiency:** measured call, dispatch, import, initialization, startup, bundle, allocation, or latency cost.

A path can be easy to navigate but expensive, or fast but opaque. Do not use an architectural preference as performance evidence.

## Trace the relevant topology

Start from one concrete behavior or startup path. Follow:

- the synchronous call stack from entry to result or effect
- strategy selection, registries, dependency injection, decorators, middleware, callbacks, generated bindings, reflection, or string-keyed dispatch
- explicit continuations after task, event, queue, process, or network boundaries; do not pretend they share one literal stack
- error propagation, wrapping, retry, fallback, and cancellation
- imports and module initialization that the path triggers
- representative tests, traces, profiles, bundle reports, or startup measurements

Read forward and backward. A clear callee can still have surprising callers or bypasses.

## Make frames earn their place

A frame or layer usually earns its place when it owns at least one of:

- a domain decision or state transition
- validation or contract translation
- an external effect or transaction boundary
- implementation selection at a visible composition point
- lifecycle, cancellation, concurrency, retry, timeout, or fallback policy
- stable reuse with a real owner
- security, authorization, or isolation
- observability that materially improves diagnosis

Suspect frames that only rename an operation, forward unchanged arguments, unpack and repack the same shape, retrieve ambient dependencies, or split a readable operation into one-use fragments. Several named calls can remain clearer than one dense function; optimize semantic hops, not frame count alone.

Before collapsing a frame, check callers, overrides, generated use, public compatibility, test seams, observability, and failure behavior. Before adding one, state what it owns.

## Navigation heuristics

Prefer paths where:

- the next meaningful call is predictable from the current symbol and imports
- feature terminology survives through handlers, operations, errors, logs, and tests
- orchestration exposes consequential ordering and branching
- registries and plugin tables have one typed or statically enumerable manifest
- configuration selects implementations at a visible composition boundary
- important callbacks and middleware stages are named and ordered explicitly
- stack traces preserve feature owners instead of collapsing into `handle`, `process`, `run`, or framework internals
- async producers, messages, registrations, consumers, and failure policies are discoverable

Friction signals include callback tunnels, wrapper factories, broad service locators, import-time self-registration, decorators that hide business behavior, reflection without a manifest, middleware-order policy, event chains used as local function calls, and parallel old/new paths to the same outcome.

Choose the smallest intervention: name a callback, expose a manifest, move selection to the composition root, inline a pass-through wrapper, restore error provenance, or remove a bypass. Do not impose `route -> use case -> domain -> repository` when the codebase has a simpler honest shape.

## Import and initialization heuristics

Import cost is runtime- and toolchain-specific. First establish whether imports are interpreted, compiled, bundled, tree-shaken, cached, or executed for side effects.

Inspect for:

- top-level IO, client construction, large data parsing, filesystem scans, registration, or mutable global setup
- cycles that force partial initialization, awkward late imports, or broad ownership coupling
- barrel, prelude, wildcard, or package-root imports that pull substantially more code into startup or a bundle
- repeated boundary conversions caused by package layout
- eager loading of optional, platform-specific, or cold functionality
- scattered dynamic imports that hide dependencies or move latency into an interactive path

Useful interventions can include explicit initialization owners, narrower entrypoints, cycle removal, type-only imports where the toolchain supports them, and lazy loading of measured cold or optional work. Lazy loading is a trade: it can improve startup while worsening first-use latency, failure timing, static navigation, and packaging. Keep it deliberate and visible.

Measure the metric that matters: cold and warm startup, request latency, module-load timing, bundle/chunk size, memory, compiler output, or profile samples. Compare the same representative command or workload before and after; one noisy run is not evidence.

## Report and validate

For findings, state:

- the behavior or startup path inspected
- the observed stack/import topology and evidence
- whether the problem is semantic, runtime, or both
- which hops earn their place and which do not
- the smallest coherent change and its tradeoffs
- the measurement or behavioral checks that would prove improvement

After edits, trace the resulting path again. Verify behavior, error provenance, active callers and continuations, and the relevant performance baseline; compilation alone does not prove a better topology.
