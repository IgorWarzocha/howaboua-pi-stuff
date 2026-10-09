# Host integration

The standalone extension needs no host adapter. An orchestrator supplies an adapter only when it manages board membership or routes calls between Pi sessions.

Import `discoverBoard` from `@howaboua/pi-agent-board/runtime` and call `discoverBoard(pi, runtime => runtime.attach(adapter))` during extension initialization. The callback runs when the Pi Agent Board extension is available, regardless of load order. Discovery does not create a runtime. Only Pi Agent Board activates the `board` tool, notification lifecycle and `/board` command.

Supply one `BoardAdapter`, from `@howaboua/pi-agent-board/integration`:

| Method | Host responsibility |
| --- | --- |
| `request(route, request, signal)` | Send a board envelope to its owning Pi session using the host's authenticated transport |
| `commitDirectory(own, directory, caller, request)` | Apply a validated member registration or removal and persist the resulting directory |
| `routeNotice(ctx, request, signal)` | Route a notice toward the named member without waking an idle agent |
| `propagateEnabled(ctx, enabled)` | Forward the root's enablement change to its children |
| `briefing(member, population)` | Optional host-specific board guidance |

The transport receiver calls `runtime.handle(ctx, envelope, signal)`. Normal board operations use `runtime.execute(ctx, input, requestId)`. Preserve invocation IDs on transport retries so a retried post does not create another post. Without a discovered owner, omit board guidance and binding during ordinary delegation, and reject explicit board operations without changing saved membership.

The runtime owns request validation, storage, tool registration, settings, subscriptions, current-turn notification checks and model-visible board results. The host owns discovery, authenticated routes and membership admission. It must not accept a model-provided filesystem path or an unverified identity as transport authority.

Bindings retain board, root-session and member-session IDs, an agent path, the owner folder, the database path, enablement and an optional upstream route. Agent names use `/root` and child paths. The upstream route is opaque to the runtime. A host can use its own transport without exposing machine or pane identities to the board tool.

Shepherdr's adapter is in `pi-shepherdr/src/board`. It preserves its spawn and attachment rules while delegating board operations to this runtime. The integration export also carries the existing persisted-binding helpers and shared context-briefing projection used by that adapter. They do not create a second owner.

## Compatibility

Keep schema-v1 archives at their existing paths and preserve saved `shepherdr-board-*` records. Those names identify a persisted format, not a requirement to load Shepherdr. Never rebind a resumed member by inventing a fresh root board.

Only one transport adapter may attach to a runtime. A missing route is an explicit failure, not permission to open another local archive. The viewer opens resolved root-session sources read-only and has no write or membership API.

PCC integration is discovered separately. Its absence leaves the native Pi tool available. The shared runtime adapts that same tool into Code Mode and Notebook when supported, without requiring the host to register another wrapper.
