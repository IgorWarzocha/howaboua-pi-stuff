Penalize these in central paths and public contracts:

- untyped dictionaries, broad `Any`, loose JSON, reflection, monkeypatching, and string-keyed dispatch carrying domain meaning
- import side effects, mutable module state, hidden singleton clients, environment reads, and connection setup at import time
- broad exception handlers, silent fallback values, swallowed cancellation, and logging without propagating a failure that still matters
- catch-all `utils.py`, `helpers.py`, `common.py`, `models.py`, `services.py`, and framework godfiles
- path mutation, local-import cycle workarounds, and tests that depend on import order
- real network services, shared mutable fixtures, sleep timing, and order-dependent tests

Validate CLI, environment, HTTP, file, queue, database, notebook, and third-party input at the boundary. Keep named domain data afterward with dataclasses, attrs models, schemas, `TypedDict`, enums, `NewType`, or protocols when they preserve real meaning. Do not introduce wrappers only to satisfy a pattern.

Keep domain decisions independent of framework requests, ORM sessions, global clients, and environment reads. Use explicit result or error types for expected failures instead of ambiguous `None`, empty values, booleans, or magic strings.

Protocols belong at real behavioral boundaries and should expose only what the consumer needs. Do not create protocols solely to mock internal code. Keep IO behind an adapter only when it isolates a real effect or external contract.

Treat `__init__.py` re-exports, plugin discovery, decorators, module registries, and import-time registration as runtime topology. Keep active registrations enumerable and initialization ownership visible. Break cycles by clarifying ownership rather than scattering local imports.

Measure import time on the representative entry point before claiming import performance. Avoid module-level client construction, model loading, filesystem scans, large parsing, and environment-dependent state. Own them in an application lifespan, command, explicit factory, or cache with a clear lifetime.

Async code requires one owner for event-loop entry, app lifespan, clients, tasks, cancellation, timeouts, errors, and shutdown. Avoid nested event-loop runners, fire-and-forget mutation, blocking work inside the loop, dropped task errors, and cleanup that swallows cancellation. Prefer structured task ownership and explicit async context managers where available.

Typing migrations in older repositories should proceed by owned boundary and module, not mass annotation churn. Start where data enters or leaves and where stable domain decisions live. Do not turn ignores, `Any`, casts, missing-import suppression, or per-file weak modes into permanent architecture.

For owned async behavior, replace timing sleeps with explicit synchronization or controllable time.
