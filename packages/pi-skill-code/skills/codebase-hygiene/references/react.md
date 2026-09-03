Apply these rules when writing, refactoring, or reviewing React in a maintained application.

Inspect the React and framework versions, rendering boundary, compiler, data layer, state libraries, nearby conventions, tests, and checks. For each changed behavior, identify its source of truth, every initiator, its component or external owner, its lifetime identity, and every visible phase. Preserve established owners.

Implement at the first layer that owns the behavior completely:

1. Native platform or framework semantics
2. A value derived during render
3. The initiating event
4. State in the smallest stable component
5. An Effect synchronizing with an external system

Do not use a later layer to bypass an earlier one. Call Hooks only at component or custom-Hook top level.

- Keep render pure. Derive computable values instead of synchronizing copies. Model exclusive phases as one variant, not flag bags.
- Treat identity as a lifetime boundary. Key the state owner when its whole lifetime should reset. Never repair a previously rendered entity with an Effect.
- Put user-triggered work and one-shot browser methods in the initiating event. Delete state whose only purpose is to trigger an Effect.
- Use one Effect for one active external lifecycle. Declare every input and release the exact timer, request, observer, subscription, worker, or connection acquired.
- Use refs only for handles, imperative resources, hot-path objects, and synchronous re-entry guards. Never use liveness refs or hide changing props from dependency checks.
- Block duplicate mutations before the first await. Capture operation inputs, clear pending ownership in `finally`, distinguish failure from empty success, and use one stale-work mechanism unless another race survives.
- Validate complete external values before rendering or caching them. Keep secrets out of clients and storage. Never inject unsanitized HTML. Keep server and browser initial renders identical.
- Let adopted frameworks, caches, and stores own their lifecycles. Keep keys and clients stable, subscribe narrowly, update immutably, roll back failed optimism, and invalidate the exact affected identity.
- Keep module dependencies one-way and public surfaces narrow. Avoid internal barrel imports and cycles. Put optional heavy code behind a real route, feature, or initiating-action boundary. Prove code unused across static imports, dynamic registries, configuration, and runtime entry points before deleting it.
- Split components at ownership boundaries. Prefer explicit variants over boolean-prop combinations. Never define components inside render or call them as ordinary functions.
- Keep context narrow. Memoize only measured expensive work or identity consumed by a real boundary. Virtualize collections much larger than the visible window.
- Prefer native elements and framework primitives. Preserve names, labels, focus, keyboard ownership, pending control identity, unique IDs, and reduced-motion behavior.
- Keep per-frame, pointer, scroll, gesture, and large per-item paths out of ordinary React state. Reuse runtime-owned resources and publish only semantic commits.

Trace every initiator to its result, failure, and cleanup. Check duplicated state, impossible phases, stale completion, hydration differences, unstable identity, unsafe sinks, broad context, boolean-prop combinations, and unnecessary machinery. Return the smallest complete change. Do not invent infrastructure or compatibility behavior without a concrete requirement.

Run focused tests, repository React checks, and any available React diagnostic scan. Fix the owner instead of suppressing the diagnostic.
