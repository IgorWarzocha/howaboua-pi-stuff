# Sites workflow

Use only for requested Sites work. Every deployment is production. Stay within the requested scope, including local-only or save-only work, and preserve the audience unless asked to change it.

1. For an existing Site, resolve its ID and audience with `site.get`. Reuse the correct bound checkout or fetch source into a new directory with `site.open`. For a new hosted Site, work in a fresh directory and use `site.create` once. It starts private and unpublished. Commit the binding and intended source. For local-only work, skip registration and publication. Hosting-only changes do not need a checkout.
2. Read `building` before choosing a deploy format. Preserve the project's build integration and validate the key flow locally with the preview surface available to the user.
3. Read `version` before saving. Use `version.save` for a candidate without deployment or `version.publish_private` for approved publication of new source to a confirmed owner-only Site. Check `site.get` when ownership or access is unknown.
4. For a saved candidate, use `deployment.deploy` with its opaque `version_id` and explicit audience path.
5. Poll `deployment.status` only for `pending`, `building` or `publishing`. Report a URL from a successful result, not merely a local build or pending deployment.

For partial-save or audience conflicts, see `version` and `deployment`. Keep runtime secrets out of source and hosting metadata. For `terms_required`, the user MUST accept terms at the returned URL before retry.
