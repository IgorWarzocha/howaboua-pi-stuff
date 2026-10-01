# Site operations

- `site.list`: owned Sites by default, limit 20. `role: "editor"` selects shared editable Sites. Reuse returned cursors with unchanged `role`/`include_editable` filters.
- `site.get`: metadata, access and linked automations. Set `include_mcp_connection: true` for the published MCP connection and provisioned plugin ID. Reading it does not install or connect anything. See `mcp`.
- `site.create`: only without a local `project_id`. Supply `title`, `slug`, optional `description` and `creation_intent` (`user_requested`, `proactive`, `unknown`) reflecting the original request. The facade atomically preserves other manifest fields and saves the returned ID. A missing repository credential is not a reason to create again.
- `site.update`: display `title`, not URL.
- `site.slug`: change public URL label. For a pending result, observe with `site.get`, never repeat the mutation to poll.

Slugs start with a lowercase ASCII letter, then lowercase letters, digits or single hyphens. No trailing/consecutive hyphens, reserved labels or collisions. Backend validation determines availability.

`enable_plugins: true` on creation requests workspace connector access, subject to workspace eligibility. It is not an MCP-publication toggle. Omit it for ordinary Sites and MCP-only Sites. `publish_on_push` is rejected, including null.
