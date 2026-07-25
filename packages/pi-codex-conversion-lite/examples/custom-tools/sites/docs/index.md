# ChatGPT Sites custom tool

This is an exploratory, private-API bridge from Pi to ChatGPT Sites. The backend is in public beta and may change. Use the facade rather than guessing remote MCP names.

## First use

1. Read `sites_documentation("workflow")`.
2. Read the resource topic you need.
3. For exact parameters, read `sites_documentation("resource.action")`.
4. Call `sites` with one resource, action, and `params` object.

```js
await tools.sites(JSON.stringify({
  resource: "site",
  action: "list",
  params: { limit: 10 }
}))
```

## Topics and resources

| Topic | Actions |
|---|---|
| `site` | `list`, `get`, `create`, `update` |
| `version` | `list`, `get`, `save` |
| `deployment` | `deploy`, `status` |
| `access` | `get`, `update` |
| `environment` | `get`, `update` |
| `domains` | resource `domain`: `list`, `add`, `refresh`, `remove` |
| `analytics` | `overview`, `events`, `query` |

`project_id` is read from `<project>/.openai/hosting.json` when omitted. Pass `project_dir` when Pi's current directory is not the Site project.

The tool never returns OAuth tokens, source-repository credentials, secret environment values, or SIWC bypass tokens. Unknown operations return one documentation pointer instead of the full catalog.
