# Browser custom tool

This command-backed custom tool drives a logged-in Chromium browser through the Chrome DevTools Protocol. Its operations follow Codex `web__run` vocabulary: `ref_id`, numbered element `id`, `lineno`, `find`, `click`, and batched operation arrays.

The CDP implementation derives from [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill) under the adjacent MIT license.

## Install

Copy `browser.toml` and its companion directory into the custom-tool directory:

```sh
mkdir -p ~/.pi/agent/codex-conversion-custom-tools/browser
cp browser.toml ~/.pi/agent/codex-conversion-custom-tools/
cp browser/*.mjs ~/.pi/agent/codex-conversion-custom-tools/browser/
```

When `PI_CODING_AGENT_DIR` is configured, use `$PI_CODING_AGENT_DIR/codex-conversion-custom-tools/` instead. Reload Pi after installing it.

The normal loop is `tabs` → `open` → `find`/`click`/`type`. Do not close a shared browser after a task.

## Browser setup

The tool requires Node 22+ and a Chromium-family browser exposing CDP. It probes `CDP_HOST` and `CDP_PORT`, then browser `DevToolsActivePort` files. The `start` action can launch Chromium through a Linux systemd user session; other environments must start a browser with remote debugging separately.

## Optional SSH routing

SSH routing code is included but disabled and hidden from the tool prompt and help. To enable it:

1. Add allowed SSH host names to `HOSTS` in `browser.mjs`.
2. Set `REMOTE_TOOL_PATH` to the absolute path of `browser.mjs` on those hosts.
3. Add aliases to `HOST_ALIASES` when a machine's hostname differs from its SSH name.
4. Copy the browser companion directory to the configured remote path.
5. Replace the active `usage` in `browser.toml` with the commented SSH-aware version.

SSH must already work non-interactively. Remote screenshots use `scp`, and the remote machine must provide Node 22+ and its own CDP-enabled browser.

## Files

- `browser.toml` — model-facing custom-tool definition
- `browser.mjs` — input validation, batching, routing, output limits, and result caching
- `cdp.mjs` — lightweight CDP client and per-tab daemon
- `*.test.mjs` — deterministic parser, routing, output-boundary, and CDP checks
