# ChatGPT Sites

Private beta API. Read `workflow`, then the relevant topic. `resource.action` returns that guide and a compact live parameter schema.

Call `sites` with `{resource, action, params}`. Omitted `project_id` uses `.openai/hosting.json`. `params.project_dir` selects another project root. Copy IDs and cursors unchanged.

| Topic         | Resource actions                                    |
| ------------- | --------------------------------------------------- |
| `site`        | `site`: `list`, `get`, `open`, `create`, `update`, `slug` |
| `version`     | `version`: `list`, `get`, `save`, `publish_private` |
| `deployment`  | `deployment`: `deploy`, `status`                    |
| `access`      | `access`: `get`, `update`                           |
| `environment` | `environment`: `get`, `update`                      |
| `domains`     | `domain`: `list`, `add`, `refresh`, `remove`        |
| `analytics`   | `analytics`: `overview`, `events`, `query`          |
| `diagnostics` | `diagnostics`: `logs`                               |
| `database`    | `database`: `overview`, `rows`                      |
| `schedules`   | `schedule`: `create`, `validate`                    |

`building` covers build, storage, local preview, app connectors and WebMCP. `identity` covers sign-in and service access. `mcp` covers Site-hosted tools and connection. Git credentials stay out of results. Secret environment values and service-access tokens are redacted.
