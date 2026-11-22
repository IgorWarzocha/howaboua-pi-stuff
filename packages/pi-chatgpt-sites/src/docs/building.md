# Build boundaries

Keep the existing Sites build and auth integrations. For simple pages, use HTML, CSS and browser JavaScript without adding a framework. Use a server only for requirements such as durable storage, MCP or workspace connectors.

- **Static:** Set `static.directory` to `dist`, `dist/client`, `out`, `build`, or `.output/public`. That directory must contain `index.html` and its assets.
- **Worker:** Omit `static`. Produce `dist/server/index.js` as an ES module that default-exports an object with a `fetch` handler. Hosted Workers have 128 MB per isolate and cannot make raw TCP connections. Preserve the `sites()` build integration in existing Vinext projects.

Hosting metadata holds `project_id`, optional `static`, logical `d1`/`r2` bindings, verified `plugins`/`connectors` and supported requested `capabilities`. Runtime values belong in `environment`, not this file. Use `"mcp"` for Site-hosted MCP and read `mcp` for authorization and connection.

Use D1 for structured records and R2 for files, accessed server-side. Browser storage is for device-local preferences. Preserve binding names and leave unused bindings null. Use one statement per D1 `prepare()` or group statements with `batch()`. Keep migrations schema-only. Generate and review them before building, then test them against local D1. Hosted and local data are separate. Deployment can fail after applying migrations. Do not edit applied SQL or its migration metadata. Fix only an identified failed, unapplied migration and stop if the applied boundary is uncertain.

## Preview and checks

Use the project's dev command or a static HTTP server. Check a representative page and exercise the primary flow in an available browser. For user-facing previews on a remote machine, use supported forwarding. A remote loopback URL is not a user preview. Keep one preview during edits and stop the server at teardown. Pi's Sites tools do not launch or open managed previews. Report any browser verification that could not run.

## App connectors

Workspace connectors require Site-specific eligibility discovery, allowed connector IDs and actions, manifest declarations, visitor sign-in and consent. Pi's Sites tools lack that discovery and invocation surface. Leave declarations unchanged without verified eligibility. Native app access in the authoring session does not establish eligibility, and preview access does not establish hosted visitor consent.

When supported elsewhere, keep connector calls request-scoped and server-side, with validated inputs, server-owned targets and private/no-store responses. Only `status: "success"` confirms a result. Reconnect only for `reauthentication_required`; an upstream failure may have completed a write, so verify before retrying. Requested browser writes require an explicit visitor action and `action_selection_mode: "all"` plus platform consent/permissions. Static builds cannot invoke connectors. Never deploy preview grants or substitute service access for visitor identity.

## Browser WebMCP

When browser-agent access materially helps, feature-detect `document.modelContext` and register only existing page actions. Reuse their input validation and authorisation, and unregister on teardown. Verify a call and its visible result in a supported browser. These tools require an open page and cannot substitute for Site-hosted `mcp` or unattended updates.
