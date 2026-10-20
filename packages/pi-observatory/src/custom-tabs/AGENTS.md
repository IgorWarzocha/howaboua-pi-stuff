Loading bundles and serving HTTP must not start collectors. Only start() launches them; close() must finish process-group cleanup before the server releases its locks. A child exit is not proof that its descendants or inherited pipes have closed.

Query commands are optional, read-only consumers of their bundle's own index, not collectors or readers of source logs/core SQLite. Reuse collector process-group cleanup; hold each of the four per-tab query slots until process cleanup completes. HTTP cancellation and close() must stop and await active queries.

Publish a new snapshot only after bounded JSON parsing and successful atomic persistence. Keep collection errors separate from the last successful data and timestamp.

Only web/ is public. Resolve asset containment against real paths; never expose collector code or state through the asset route. This is a trusted-code feature, not a filesystem or browser security sandbox.
