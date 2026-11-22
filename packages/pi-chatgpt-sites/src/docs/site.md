# Site operations

- `site.list`: owned Sites by default, limit 20. `role: "editor"` selects shared editable Sites. Reuse returned cursors with unchanged `role`/`include_editable` filters.
- `site.get`: metadata, access, publication state, remix eligibility and linked automations when available. Set `include_mcp_connection: true` for the published MCP connection and provisioned plugin ID. Reading it does not install or connect anything. See `mcp`.
- `site.open`: fetch existing committed source into a new local directory. Pass the exact `project_id` and a `project_dir` that does not exist yet, with an existing parent. Edit the returned `checkout_path`. Opening does not install dependencies, push, save or deploy. If the Site has no Git source yet, reuse its ID with the original source checkout rather than registering a replacement.
- `site.create`: only without a local `project_id`. Supply `title`, `slug`, optional `description` and `creation_intent` (`user_requested`, `proactive`, `unknown`) reflecting the original request. The facade atomically preserves other manifest fields and saves the returned ID. A missing repository credential is not a reason to create again.
- `site.update`: display `title`, not URL.
- `site.slug`: change public URL label. Poll pending changes only with `site.get`.

Slugs start with a lowercase ASCII letter, then lowercase letters, digits or single hyphens. No trailing/consecutive hyphens, reserved labels or collisions. Backend validation determines availability.

`enable_plugins: true` on creation requests workspace connector access, subject to workspace eligibility. It is not an MCP-publication toggle. Omit it for ordinary Sites and MCP-only Sites. `publish_on_push` is rejected, including null.

Pi can find owned or editable Sites with `site.list`. It cannot search the Sites Library or remix a published Site. Use the desktop Sites workflow for a requested remix when that account supports it. A remix creates a separate unpublished Site from published source without copying runtime settings, database records or uploaded files. Do not use `site.open` as a substitute for remix permission.
