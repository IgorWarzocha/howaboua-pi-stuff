---
"@howaboua/pi-codex-conversion": patch
---

**BREAKING CHANGE:** Removed the bundled Sites custom tools. Remove the old `sites.toml`, `sites_documentation.toml` and companion directory, install `@howaboua/pi-chatgpt-sites`, then reload Pi. Existing repository bindings are preserved. Calls now use structured objects with `sites({resource, action, params})` and `sites_documentation({topic})`.
