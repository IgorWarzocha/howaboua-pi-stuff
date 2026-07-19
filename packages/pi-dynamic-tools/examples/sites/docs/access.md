# Access operations

Hosting does not automatically make a Site public. New Sites normally begin with owner/admin-only access, subject to workspace policy.

## `access.get`

Returns only the Site ID, title, live URL, access mode, access policy, and currently available modes. This intentionally omits unrelated Site fields.

## `access.update`

Change access only when the user asks. Pi custom tools have no trusted approval callback, so calling this action applies the change immediately.

Backend modes can include:

- `public`: anyone with the URL;
- `workspace_all`: active users in the workspace;
- `custom`: supplied user and group allowlists.

For `custom`, omitted allowlists preserve existing values; empty lists clear non-owner entries. IDs and eligible modes depend on workspace policy. Never invent group IDs. The owner remains allowed.

Before widening access, review the deployed content, data handling, forms, uploads, links, and sign-in behavior. Public publishing may be disabled by an admin.
