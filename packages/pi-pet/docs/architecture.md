# Architecture

## Ownership

```text
Pi lifecycle + tools
        │
        ▼
extensions/index.ts ── authenticated HTTP/SSE ── src/server/broker.ts
                                                      │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
              browser displays                              Electron thin shell
```

- `src/protocol/` owns names, bounds, wire shapes, and boundary parsers.
- `src/server/` owns credentials, the single active prompt session, current state, fanout, static delivery, and pet loading.
- `src/web/` owns canvas animation, pointer direction, local previews, and explicit prompt UI.
- `src/desktop/` owns native window lifecycle, desktop config, local attention preferences, navigation confinement, and a cursor-only sandboxed bridge. It loads the broker-hosted renderer instead of duplicating display transport or animation.
- `extensions/` maps documented Pi events and tools to broker calls. It contains no renderer or authoring logic.
- Agent tools are limited to expression and pet-data reloads. Operational status is exposed through `/pet-status`, `pi-pet status`, and authenticated `GET /api/v1/status`, not an always-present model tool.
- `skills/pi-pet/` teaches catalog-aware control and data-only pet authoring.

## State flow

The extension reduces Pi events to the typed activity states `idle`, `working`, `waiting`, `failed`, and `settled`. Its latest-state publisher serializes broker updates and coalesces stale intermediate work, while tool-call IDs preserve waiting precedence during parallel work. The broker maps semantic activity onto pet actions and includes both fields in display snapshots.

The broker also holds one stable action plus optional transient action, note, and speech bubble. `state` commands replace the stable action. `action` commands and settled review play once for the manifest's total frame duration, then return to the stable idle action. Displays receive a normalized catalog and snapshots over SSE. Size, quiet, snooze, and cursor proximity are local desktop presentation policy and never mutate this shared state.

## Prompt flow

1. A display submits bounded plain text with its visible device name.
2. The broker accepts it only while one authenticated Pi extension stream is live.
3. The prompt receives a unique ID and is replayed only to reconnects of that same extension session until acknowledged.
4. The extension prefixes provenance and calls `pi.sendUserMessage`; busy sessions use `followUp`.
5. The extension acknowledges acceptance or failure, which is broadcast to displays.
6. After that pet-originated run settles, the extension publishes one bounded final assistant text block as a speech bubble; reasoning and tool output are excluded.
7. A different Pi session rejects the old session's unacknowledged prompts; they are never replayed across sessions. Unacknowledged prompts expire after 30 seconds.

## Pet flow

`pet.json` supplies a verified Codex-v2 base. `pet.pi.json` overlays arbitrary named frame sequences without changing extension code. Loading validates the strict schema, real paths, file sizes, PNG/WebP dimensions, decoded pixel limits, and frame bounds before replacing the live catalog. A failed reload leaves the previous catalog active.
