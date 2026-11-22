# Site-hosted MCP

Preserve existing `.openai/hosting.json` capabilities and add `"mcp"`. Implement stateless JSON-RPC `POST /mcp` in the Site's server runtime. Prefer MCP `2026-07-28`:

- `server/discover`: return `supportedVersions: ["2026-07-28"]` and `capabilities: {tools: {}}`.
- `tools/list`: return a `tools` array with each tool's `name` and `inputSchema`. Keep discovery free of private data.
- `tools/call`: validate `params.name` and `params.arguments`, return MCP `content` blocks and set `isError: true` for tool failures.

Authorise every data-bearing call against the forwarded Sites identity. Return HTTP 401 or 403 when unauthorised. Preserve Sites-managed OAuth and existing access rules. See `identity` for the forwarded headers and service access boundary.

Publishing provisions the owner's App and private plugin. Republishing refreshes its tools from the Site's `tools/list`. Reuse this plugin; do not configure local MCP or login commands.

The plugin may already be connected. Verify with an available read-only plugin tool. If tools are missing, call `site.get` with `include_mcp_connection: true` for the plugin ID. An ID alone does not confirm installation. Pi lacks native `plugin_management.suggest_plugins`; direct the user to **Plugins > Personal > Created by you** to install or connect. If already installed, try a new chat.

MCP is not browser WebMCP: WebMCP actions operate in an open page and cannot provide this cloud connection. `enable_plugins` concerns workspace connectors used by the Site, not publication of the Site's MCP tools.
