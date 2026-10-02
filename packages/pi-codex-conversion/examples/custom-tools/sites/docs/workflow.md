# Sites workflow

Use only for requested Sites work. Every deployment URL is production. Pi has no native approval callback: publish only within the user's requested scope, preserving the current audience. Respect local-only, save-only and no-publication requests.

1. Reuse `.openai/hosting.json`'s `project_id`. If absent, `site.create` registers once and merges the ID atomically. Commit that binding with all intended source.
2. Validate the compatible build locally. Read `building` for runtime constraints.
3. Use `version.save` for a saved candidate without deployment. For intended publication of new source already known owner-private for this account, use `version.publish_private` instead. Both require a clean, committed, bound repository and push exact HEAD internally.
4. Deploy an existing saved candidate through `deployment.deploy` with its opaque `version_id` and explicit audience path. Do not save it again.
5. Poll `deployment.status` only for `pending`, `building` or `publishing`. Report a URL from a successful result, not merely a local build or pending deployment.

Read `version` before saving: Pi has no archive uploader and these routes use remote build fallback. Automatic publication on Git push is unsupported.

If ownership or access is unknown, read `site.get` before selecting publication. Private calls are not access probes. After `site_not_owner_only`, reread access and report any audience mismatch. Never alter access or silently switch to shared deployment. Keep `error.details.saved_version_id` if saving succeeded but deployment failed, then recover with saved-version deployment.

Keep runtime secrets out of source and hosting metadata. `terms_required` requires the user to accept the returned URL in a browser before retrying.
