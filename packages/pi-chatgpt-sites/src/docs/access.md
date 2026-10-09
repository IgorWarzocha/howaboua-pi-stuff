# Access

`access.get` returns ID, title, live URL, access mode/policy and available modes. Use `site.get` for full metadata, ownership, external-invite eligibility or linked automations.

`access.update` applies immediately with no Pi approval callback. Change access only when requested, never to unblock deployment. Omit `access_mode` for collaborator-only changes. Modes: `public` for anyone with the URL, `workspace_all` for active workspace users, `custom` for allowlists. Workspace policy can prohibit widening access.

Omitted allowlists preserve existing entries; empty lists clear non-owner entries. The owner stays allowed. `allowed_user_emails` replaces the complete user/external-visitor list. Use `viewer_changes` with exact account user IDs for incremental workspace changes, not together with email replacement. `editor_changes` affects same-workspace editors. Before adding external visitors, confirm `site.get.external_visitor_invites_enabled`; addition may send an email invitation.

New group IDs require supported `list_available_access_groups` discovery and user selection. This facade does not provide that lookup. Never invent IDs or treat missing discovery as permission to widen access.
