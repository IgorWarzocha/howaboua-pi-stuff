# Deployment operations

Every deployment is a production change. Use a saved `version_id` within the requested scope, preserving the audience unless the user asks to change it. For new source known owner-private, see `version.publish_private`.

## `deployment.deploy`

Required facade parameters: `project_id` (or local manifest), `version_id`, and `visibility`.

- `visibility: "private"` uses the owner-only deployment path. The backend refuses it unless the caller is the sole explicitly allowed viewer and no groups are allowed.
- `visibility: "shared"` selects the general production route for confirmed non-owner-only access. This does not change the Site's audience. If access is unknown, read `site.get` before choosing.

```js
tools.sites({
	resource: "deployment",
	action: "deploy",
	params: {
		version_id: "<opaque-version-id>",
		visibility: "private",
	},
});
```

If private deployment is rejected because access is not owner-only, reread `site.get` and report the audience conflict. You MUST NOT change access or silently fall back to shared deployment.

If a Site was deliberately taken offline, use the supported republish flow in Sites rather than using a new deployment to bypass that state. Pi has no dedicated republish action.

`tunnel_bindings` replaces the complete private HTTP binding set. Omit to preserve it or pass an empty list to remove all. Copy registered tunnel IDs exactly. A lower_snake_case alias becomes `CUSTOMER_HTTP_<UPPER_ALIAS>` in Site code. Atomic source publication preserves existing bindings.

## `deployment.status`

Pass the exact `project_id` and returned deployment `id` as `deployment_id`. Omit deprecated `version_id`: the deployment identifies its saved version. Poll only while status is `pending`, `building` or `publishing`, or when the user asks for progress.
