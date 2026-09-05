# pi-browser

One logged-in browser tool for ordinary Pi, Code Mode and Notebook Mode.

The extension is the TypeScript counterpart of Pi Codex's browser custom tool. It keeps a persistent typed CDP session for the local browser while preserving the same help-first actions, SSH host routing, batching, accessibility references, bounded continuations and screenshot paths.

## Install

```bash
pi install npm:@howaboua/pi-browser
```

Requires Pi 0.84.3 or newer, Node.js 22.19 or newer, and a Chrome-family browser with remote debugging enabled at `chrome://inspect/#remote-debugging`.

Pi Codex 3.0.25 or newer is optional. Without it, Browser remains a normal top-level Pi tool. Do not load Pi Codex's example `browser.toml` custom tool alongside this extension.

## Use

In normal Pi, call `browser` with `action: "help"` before first use. In Code or Notebook Mode, start with:

```js
await tools.browser("help")
```

Normal Pi exposes the single-action contract. Code and Notebook Mode also accept batched freeform requests. A common route is `tabs`, then `open`, then `click` or `type` with the returned `ref_id` and element ID.

Long Code and Notebook calls use the normal `exec` and `wait` lifecycle. Cancellation stops pending CDP work, though an already dispatched browser mutation may still take effect.

## Host routing

In Pi's interactive TUI, run `/browser`, add the SSH host names, identify the current machine, then save. Pi reloads the extension with the corresponding `host` choices. Advanced settings expose the remote Node command, which defaults to `node`.

Each name must be an existing SSH alias. On first use, the extension atomically installs or updates its managed worker at `~/.pi/agent/pi-browser-worker.mjs` on that host, then invokes it against the host's local CDP browser. No package installation is required on routed machines. Screenshots return through SCP and the remote artifact is removed. Keep `host` on follow-up calls that use a returned ref, screenshot, or continuation handle. Settings are stored in `pi-browser.json` under Pi's agent directory; `PI_BROWSER_CONFIG` overrides that storage path.

## Browser startup

The tool discovers CDP through `CDP_PORT`, port 9222, or `DevToolsActivePort`. Set `CDP_PORT_FILE` for a non-standard port file.

The `start` action runs on the selected host and can launch Chromium through a Linux systemd user session. Override the executable with `CDP_BROWSER` and the profile with `CDP_PROFILE_DIRECTORY`. On other systems, start the browser normally with remote debugging enabled.

## Boundaries

Keep each result's `ref_id` and element IDs together. Continue truncated output with the returned line, offset or result handle.

Ask before unfamiliar low-trust navigation or consequential external actions such as sending, posting, purchasing, uploading, deleting or changing account settings, unless the user already authorized the action. Never close a shared browser after a task.

The CDP implementation is based on [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill).
