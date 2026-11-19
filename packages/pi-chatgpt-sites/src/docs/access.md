# Access

`access.get` returns ID, title, live URL, access mode/policy and available modes. Use `site.get` for full metadata, ownership, external-invite eligibility or linked automations.

`access.update` applies immediately without a separate approval step. You MUST NOT change access unless the user requested that change. Omit `access_mode` for collaborator-only changes. Modes: `public` for anyone with the URL, `workspace_all` for active workspace users, `custom` for allowlists. Workspace policy can prohibit widening access.

Omitted allowlists preserve existing entries; empty lists clear non-owner entries. The owner stays allowed. `allowed_user_emails` replaces the complete user/external-visitor list. Use `viewer_changes` with exact account user IDs for incremental workspace changes, not together with email replacement. `editor_changes` affects same-workspace editors. Before adding external visitors, confirm `site.get.external_visitor_invites_enabled`; addition may send an email invitation.

New group IDs MUST come from user selection after `list_available_access_groups` discovery. Sites tools lack that lookup; stop additions that need a new group ID rather than widening access.
