# Runtime environment operations

Sites runtime values are separate from local `.env` files and `.openai/hosting.json`.

## `environment.get`

Get configured production runtime entries and their revision. The facade recursively redacts secret values even if the backend returns one unexpectedly.

## `environment.update`

Pass `set_values` and optional `remove`:

```js
await tools.sites(JSON.stringify({
  resource: "environment",
  action: "update",
  params: {
    set_values: [
      { key: "API_ORIGIN", value: "https://example.test", is_secret: false },
      { key: "SERVICE_TOKEN", value: "<secret>", is_secret: true }
    ],
    remove: []
  }
}))
```

Keys are case-sensitive. Do not repeat a key or put it in both lists. Only listed keys change. Mark sensitive values with `is_secret: true` and do not echo them in prose or logs. The tool deliberately cannot read values from arbitrary environment variables or files. For secrets that should never enter model context, use the Sites settings UI instead.

Calling this action changes production runtime configuration immediately; Pi custom tools have no separate approval callback.

Environment changes do not alter an existing deployment. Redeploy an approved saved version when the new revision should become active.
