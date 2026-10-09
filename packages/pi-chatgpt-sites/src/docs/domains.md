# Custom-domain operations

Use resource name `domain` in calls. Sites does not register domains; the user must own the hostname and control its DNS. Availability depends on plan and workspace policy.

## Actions

- `domain.list`: list current custom domains for a Site.
- `domain.add`: add a hostname and return required DNS records.
- `domain.refresh`: recheck DNS using the exact `custom_domain_id`.
- `domain.remove`: immediately detach the exact custom domain. Pi custom tools have no separate approval callback.

Typical flow:

1. Add the apex domain or subdomain.
2. Show the returned DNS names, record types, and values to the user.
3. Wait for the user to update DNS at their provider.
4. Refresh status after propagation.

Do not claim that DNS was changed merely because the domain was added in Sites. Never remove or replace a domain to solve a transient propagation delay.
