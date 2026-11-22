# Pi ChatGPT Sites

Open an existing ChatGPT Site's source in Pi, save new versions, and deploy to its current audience. You can also inspect and manage hosting without a local checkout.

```sh
pi install npm:@howaboua/pi-chatgpt-sites
```

Sign in with `/login openai-codex` using the legacy OpenAI Codex provider. The account must have Sites access. The extension uses Pi's authentication and refresh, not a separate token file.

Ask Pi to inspect your Sites. The `sites` tool returns help with no arguments, and `sites_documentation` provides topic guides and current operation parameters. In Code Mode and Notebook, both tools are automatically deferred and discoverable through `ALL_TOOLS`.

Ask Pi to open an existing Site in a new local directory. Opening fetches committed source without changing the hosted Site. Saving requires Git, a clean worktree and a committed `.openai/hosting.json` binding. A save pushes exactly the selected commit. Pi uses the remote build and cannot upload a local build archive. Deployments are production changes and require explicit audience selection.

This uses the private Sites beta API, which may change. Installation does not create or deploy a site.

## Migrating from the bundled custom tools

Remove `sites.toml`, `sites_documentation.toml`, and their `sites/` companion directory from your custom-tool definitions before installing this extension. Keep your repository's `.openai/hosting.json` binding.

Calls now use structured arguments: `sites({resource, action, params})` and `sites_documentation({topic})`. In Code Mode and Notebook, use the same objects with `tools.sites(...)` and `tools.sites_documentation(...)`.
