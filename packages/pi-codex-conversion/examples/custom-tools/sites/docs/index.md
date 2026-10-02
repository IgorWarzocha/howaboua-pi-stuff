# ChatGPT Sites

Private beta API. Read `workflow`, then the relevant topic. `resource.action` returns that guide and a compact live parameter schema.

Call `sites` with `JSON.stringify({resource, action, params})`. Omitted `project_id` uses `.openai/hosting.json`. `project_dir` selects another project root. Copy IDs and cursors unchanged.

| Topic | Resource actions |
|---|---|
| `site` | `site`: `list`, `get`, `create`, `update`, `slug` |
| `version` | `version`: `list`, `get`, `save`, `publish_private` |
| `deployment` | `deployment`: `deploy`, `status` |
| `access` | `access`: `get`, `update` |
| `environment` | `environment`: `get`, `update` |
| `domains` | `domain`: `list`, `add`, `refresh`, `remove` |
| `analytics` | `analytics`: `overview`, `events`, `query` |
| `diagnostics` | `diagnostics`: `logs` |
| `database` | `database`: `overview`, `rows` |
| `schedules` | `schedule`: `create`, `validate` |

`building` covers build, storage and connector boundaries. `mcp` covers Site-hosted tools and connection. OAuth, Git credentials, secret environment values and service-access tokens are redacted.
