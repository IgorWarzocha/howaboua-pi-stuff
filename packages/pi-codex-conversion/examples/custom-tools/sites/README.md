# Sites

An optional private-beta ChatGPT Sites bridge using Pi's OpenAI Codex OAuth. Keep `sites.toml`, `sites_documentation.toml` and this companion directory together when enabling the example.

Read `sites_documentation("index")`, then `workflow` and the relevant topic. `resource.action` retrieves a compact live parameter schema. Read-only discovery can confirm account access without creating or changing a Site.

The bridge supports source save, saved-version deployment and atomic private source publication. It requires a clean committed Site binding for source pushes. It has no archive uploader, automatic publish-on-push workflow or native approval UI. Every deployment URL is production. Preserve the requested audience.

The `mcp` topic covers Site-hosted tools, Sites-managed OAuth and the manual plugin connection path in Pi. The bridge does not expose credentials or supply an unattended updater. OAuth, terms and account failures require the stated user action, not a test mutation or guessed backend repair.
