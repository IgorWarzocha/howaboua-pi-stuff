# Site-hosted MCP

For remotely callable tools, preserve existing `.openai/hosting.json` capabilities and add `"mcp"`. Implement stateless HTTP `POST /mcp` for MCP `initialize`, `tools/list` and `tools/call` in the Site's server runtime. No local stdio server. Validate JSON-RPC arguments and keep discovery free of private data.

Sites authenticates at the hosting boundary. Trust its forwarded `oai-authenticated-user-id` as the Site-scoped user identity and `oai-authenticated-user-email` as verified email. Optional `oai-authenticated-user-full-name` is display data, percent-encoded UTF-8 when `oai-authenticated-user-full-name-encoding` is `percent-encoded-utf-8`. Decode only with that marker.

Authorize every data-bearing call for that user and return HTTP 401/403 when unauthorized. Preserve Sites-managed OAuth and existing access rules. Service access does not supply a visitor identity or connected-app consent. Do not replace OAuth or widen access to make a call succeed.

Publish through the normal workflow, reusing the App and private plugin Sites provisions for this Site. Updates reuse them too. Do not create a second App/plugin or configure local MCP/login commands.

Then call `site.get` with `include_mcp_connection: true`. Use the returned opaque plugin ID unchanged. Its presence establishes neither installation nor connection. Pi lacks native `plugin_management.suggest_plugins`, so direct the user to **Plugins > Personal > Created by you**, open the Site's plugin, then Install or Connect as needed. Verify an available read-only plugin tool after connection. A saved version or URL alone does not prove MCP works.

MCP is not browser WebMCP: WebMCP actions operate in an open page and cannot provide this cloud connection. `enable_plugins` concerns workspace connectors used by the Site, not publication of the Site's MCP tools.
