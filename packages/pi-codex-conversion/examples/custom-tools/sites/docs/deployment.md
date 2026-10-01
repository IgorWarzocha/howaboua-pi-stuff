# Deployment operations

Every Sites deployment URL is production. Deploy only a saved `version_id` within the requested publication scope and audience. For new source known owner-private, see `version.publish_private`.

## `deployment.deploy`

Required facade parameters: `project_id` (or local manifest), `version_id`, and `visibility`.

- `visibility: "private"` uses the owner-only deployment path. The backend refuses it unless the caller is the sole explicitly allowed viewer and no groups are allowed.
- `visibility: "shared"` is an open-world production deployment for shared, workspace, public, or unverifiable access.

Pi has no trusted approval callback for custom tools. Calling this action is the production effect. Preserve the existing audience unless the user requests a change.

```js
await tools.sites(JSON.stringify({
  resource: "deployment",
  action: "deploy",
  params: {
    version_id: "<opaque-version-id>",
    visibility: "private"
  }
}))
```

If private deployment is rejected because access is not owner-only, reread `site.get`. Never silently fall back or alter access. Report any conflict with the requested audience.

Optional `tunnel_bindings` replaces the complete private HTTP binding set. Omit to preserve it, empty list to remove all. Copy registered tunnel IDs exactly. A lower_snake_case alias becomes `CUSTOMER_HTTP_<UPPER_ALIAS>` in Site code. Atomic source publication preserves existing bindings.

## `deployment.status`

Pass the exact `project_id` and returned deployment `id` as `deployment_id`. Omit deprecated `version_id`: the deployment identifies its saved version. Poll only while status is `pending`, `building` or `publishing`, or when the user asks for progress.
