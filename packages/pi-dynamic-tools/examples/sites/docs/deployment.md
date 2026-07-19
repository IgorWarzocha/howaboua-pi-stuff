# Deployment operations

Every Sites deployment URL is production. Deploy only a saved `version_id` after the intended audience and content have been reviewed.

## `deployment.deploy`

Required facade parameters: `project_id` (or local manifest), `version_id`, and `visibility`.

- `visibility: "private"` uses the owner-only deployment path. The backend refuses it unless the caller is the sole explicitly allowed viewer and no groups are allowed.
- `visibility: "shared"` is an open-world production deployment for shared, workspace, public, or unverifiable access.

Pi has no trusted approval callback for custom tools. Calling this action is the production effect; the agent must obtain user approval before calling it. Shared deployment warrants an explicit audience warning.

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

If private deployment is rejected because access is not owner-only, do not silently fall back. Ask the user before making a shared deployment.

## `deployment.status`

Pass the exact `project_id`, `version_id`, and deployment `id` returned by deploy as `deployment_id`. Poll only while status is `pending`, `building`, or `publishing`, or when the user asks for progress.
