Loading bundles and read-only HTTP routes must not start collectors. Only explicit monitoring controls launch collection. Pause and close must finish process-group cleanup; close finishes before the server releases its locks. A child exit is not proof that its descendants or inherited pipes have closed.

Query commands are optional, read-only consumers of their bundle's own index, not collectors or readers of source logs/core SQLite. Reuse collector process-group cleanup; hold each of the four per-tab query slots until process cleanup completes. HTTP cancellation and close() must stop and await active queries.

Publish a new snapshot only after bounded JSON parsing and successful atomic persistence. Keep collection errors separate from the last successful data and timestamp.

Unchanged snapshots retain updatedAt. Query-backed collectors must include a revision that changes atomically with indexed data, including replay and rewrites; otherwise new rows can stay invisible to the page.

Only web/ is public. Resolve asset containment against real paths; never expose collector code or state through the asset route. This is a trusted-code feature, not a filesystem or browser security sandbox.
