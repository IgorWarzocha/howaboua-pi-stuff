# Sites workflow

Use only for requested Sites work. Every deployment is production. Stay within the requested scope, including local-only or save-only work, and preserve the audience unless asked to change it.

1. Reuse `.openai/hosting.json`'s `project_id`. If absent, `site.create` registers once and merges the ID atomically. Commit that binding with all intended source.
2. Validate the compatible build locally. Read `building` for runtime constraints.
3. Read `version` before saving. Use `version.save` for a candidate without deployment or `version.publish_private` for approved publication of new source to a confirmed owner-only Site. Check `site.get` when ownership or access is unknown.
4. For a saved candidate, use `deployment.deploy` with its opaque `version_id` and explicit audience path.
5. Poll `deployment.status` only for `pending`, `building` or `publishing`. Report a URL from a successful result, not merely a local build or pending deployment.

For partial-save or audience conflicts, see `version` and `deployment`. Keep runtime secrets out of source and hosting metadata. For `terms_required`, the user MUST accept terms at the returned URL before retry.
