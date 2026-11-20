# Build boundaries

Keep existing Sites build and auth integrations. Buildless HTML uses `static.directory` with `index.html`; only server features such as MCP and workspace connectors need Cloudflare Workers-compatible output.

Hosting metadata holds `project_id`, optional `static`, logical `d1`/`r2` bindings, verified `plugins`/`connectors` and supported requested `capabilities`. Runtime values belong in `environment`, not this file. Use `"mcp"` for Site-hosted MCP and read `mcp` for authorization and connection.

Use D1 for requested durable structured data and R2 for blob bytes, accessed server-side. Browser storage is for device-local preferences, not authoritative product records. Preserve binding names and leave unused bindings null. Use prepared single statements or batches. Generate and review schema migrations before saving. Applied migrations and matching metadata stay immutable, even after a later deployment failure. Fix only a specifically identified failed, unapplied migration. Stop if the applied boundary is uncertain.

Workspace connectors require Site-specific eligibility discovery, canonical allowed IDs and actions, manifest declarations and visitor sign-in and consent. Sites tools lack discovery and invocation. Without supported discovery, leave connector declarations unchanged and continue independent work. Ordinary native app access does not establish Sites eligibility.

When supported elsewhere, keep connector calls request-scoped and server-side, with validated inputs, server-owned targets and private/no-store responses. Only `status: "success"` confirms a result. Reconnect only for `reauthentication_required`; an upstream failure may have completed a write, so verify before retrying. Requested browser writes require an explicit visitor action and `action_selection_mode: "all"` plus platform consent/permissions. Static builds cannot invoke connectors. Never deploy preview grants or substitute service access for visitor identity.
