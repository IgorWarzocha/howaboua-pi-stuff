# Pi ChatGPT Sites

Manage ChatGPT Sites from Pi: inspect sites, save committed source, deploy saved versions, and read access, environment, domains, analytics, logs, database tables, and schedules.

```sh
pi install npm:@howaboua/pi-chatgpt-sites
```

Sign in with `/login openai-codex` using the legacy OpenAI Codex provider. The account must have Sites access. The extension uses Pi's authentication and refresh, not a separate token file.

Ask Pi to inspect your Sites. The `sites` tool returns help with no arguments, and `sites_documentation` provides topic guides and current operation parameters. In Code Mode and Notebook, both tools are automatically deferred and discoverable through `ALL_TOOLS`.

The repository binding is `.openai/hosting.json`. Source saves require Git and a clean, committed, bound repository. Saves push exact HEAD. Deployments are production and require explicit audience selection. Publication terms may require browser acceptance. Credentials and secret environment values are redacted from results.

This uses the private Sites beta API, which may change. Installation does not create or deploy a site.

## Migrating from the bundled custom tools

Remove `sites.toml`, `sites_documentation.toml`, and their `sites/` companion directory from your custom-tool definitions before installing this extension. Keep your repository's `.openai/hosting.json` binding.

Calls now use structured arguments: `sites({resource, action, params})` and `sites_documentation({topic})`. In Code Mode and Notebook, use the same objects with `tools.sites(...)` and `tools.sites_documentation(...)`.
