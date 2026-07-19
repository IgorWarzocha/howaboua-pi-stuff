# Site operations

## `site.list`

List accessible Sites. `limit` defaults to 20; use the returned cursor for another page.

## `site.get`

Get metadata, current URLs, version state, and access configuration for one opaque `project_id`.

## `site.create`

Create only when the local `.openai/hosting.json` has no `project_id`.

Required facade parameters: `title`, `slug`. Optional: `description`, `project_dir`.

The slug must start with a lowercase ASCII letter, be at least five characters, and contain only lowercase letters, digits, and single hyphens. The facade persists the new project ID atomically. It removes the short-lived source credential from model-visible output.

## `site.update`

Update user-facing metadata. The current backend supports `title`; inspect `sites_documentation("site.update")` before calling.

Examples:

```js
await tools.sites(JSON.stringify({
  resource: "site",
  action: "get",
  params: { project_dir: "/absolute/project/path" }
}))
```
