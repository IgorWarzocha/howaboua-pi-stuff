Loading bundles and serving HTTP must not start collectors. Only start() launches them; close() must finish process-group cleanup before the server releases its locks. A child exit is not proof that its descendants or inherited pipes have closed.

Publish a new snapshot only after bounded JSON parsing and successful atomic persistence. Keep collection errors separate from the last successful data and timestamp.

Only web/ is public. Resolve asset containment against real paths; never expose collector code or state through the asset route. This is a trusted-code feature, not a filesystem or browser security sandbox.
