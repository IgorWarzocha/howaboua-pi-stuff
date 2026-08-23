# Sites

Use for explicit ChatGPT Sites work. The backend is private and mutable, so verify and maintain this custom tool before relying on it.

## Verify and repair

Before the first mutating Sites action in a session:

1. Read `sites_documentation("index")` and `sites_documentation("site.list")`.
2. Call `sites` with `resource: "site"`, `action: "list"`, and the schema-valid read-only parameters.
3. If the live schema, endpoint, response, or documented operation differs from the facade, inspect `sites.mjs`, `operations.mjs`, `client.mjs`, and the affected operation document. Update the local custom-tool scripts and docs to match the verified contract, then rerun the read-only call.

If OAuth, terms, or account access fails, report the exact user action instead of changing scripts. Do not leave a known stale facade in place. Do not create a Site, save a version, deploy, change access, environment, or domains merely to test or repair the tool.

## Normal use

Read the matching `sites_documentation` topic and live operation schema before each unfamiliar action. Use the narrowest read operation first. Saving a version and deploying it are separate actions. A deployment URL is production.

The tool reads a Site binding from `.openai/hosting.json` when available. It never returns OAuth tokens, repository credentials, secret environment values, or bypass tokens.
