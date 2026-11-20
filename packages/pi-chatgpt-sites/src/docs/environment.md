# Runtime environment operations

Sites runtime values are separate from local `.env` files and `.openai/hosting.json`.

## `environment.get`

Get configured production runtime entries and their revision. The facade recursively redacts secret values even if the backend returns one unexpectedly.

## `environment.update`

Pass `set_values` and optional `remove`:

```js
tools.sites({
	resource: "environment",
	action: "update",
	params: {
		set_values: [
			{ key: "API_ORIGIN", value: "https://example.test", is_secret: false },
			{ key: "SERVICE_TOKEN", value: "<secret>", is_secret: true },
		],
		remove: [],
	},
});
```

Keys are case-sensitive. List each key once across both lists; other keys stay unchanged. Mark sensitive values with `is_secret: true`. You MUST NOT echo them in prose or logs. For secrets that must stay outside model context, use the Sites Settings UI. These tools cannot import local environment variables or files.

Calling this action changes production runtime configuration immediately.

Environment changes do not alter an existing deployment. Redeploy an approved saved version when the new revision should become active.
