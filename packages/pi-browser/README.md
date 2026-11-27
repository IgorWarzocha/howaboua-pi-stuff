# pi-browser

One logged-in browser tool for ordinary Pi, Code Mode and Notebook Mode.

The extension is the TypeScript counterpart of Pi Codex's browser custom tool. It keeps a persistent typed CDP session for the local browser while preserving the same help-first actions, SSH host routing, batching, accessibility references, bounded continuations and screenshot paths.

## Install

```bash
pi install npm:@howaboua/pi-browser
```

Requires the latest Pi release, Node.js 22.19 or newer, and a Chrome-family browser with remote debugging enabled at `chrome://inspect/#remote-debugging`.

Pi Codex 3.0.52 or newer is optional. Without it, Browser remains a normal top-level Pi tool. Do not load Pi Codex's example `browser.toml` custom tool alongside this extension.

## Use

In normal Pi, call `browser` with `{}` for help, then send JSON request strings in `command`. Explicit `command: "help"` and existing object requests remain accepted. In Code or Notebook Mode, start with:

```js
await tools.browser();
```

Code and Notebook calls return objects directly. Remove `JSON.parse` around browser results in saved code and helpers.

All modes accept single-action and batched requests described by help. A common route is `tabs`, then `open`, then `click` or `type` with the returned `ref_id` and element ID.

Long Code and Notebook calls use the normal `exec` and `wait` lifecycle. Cancellation stops pending CDP work, though an already dispatched browser mutation may still take effect.

New tabs open in the background and belong to the current Pi session. Owned tabs keep rendering during control without being brought forward, except screenshots bring their target tab to the foreground for capture. The agent can filter the tab list to its own tabs, show a tab when you want to see it, and close any tab by reference. Existing tabs remain accessible through their refs and are not silently claimed.

Ownership survives extension reloads and managed-worker restarts while the browser and local runtime state remain. Restarting the browser makes restored tabs shared again. Popups inherit ownership through Chrome's opener metadata, but can still take focus. This tool does not install a Chrome extension or create Chrome tab groups.

## Host routing

In Pi's interactive TUI, run `/browser`, add the SSH host names, identify the current machine, then save. Browser help lists the configured `host` choices. Advanced settings expose the remote Node command, which defaults to `node`.

Each name must be an existing SSH alias. On first use, the extension atomically installs or updates its managed worker at `~/.pi/agent/pi-browser-worker.mjs` on that host, then invokes it against the host's local CDP browser. No package installation is required on routed machines. Screenshots return through SCP and the remote artifact is removed. Keep `host` on follow-up calls that use a returned ref, screenshot, or continuation handle. Settings are stored in `pi-browser.json` under Pi's agent directory; `PI_BROWSER_CONFIG` overrides that storage path.

To use Pi Browser only for voice startup, add `"voiceOnly": true` to `pi-browser.json` and reload Pi. For a new file, the entire configuration can be:

```json
{ "voiceOnly": true }
```

The browser tool is unavailable to the agent, while voice startup and `/browser` host settings remain available. Keep any existing host routing fields in the same file. Remove the value or set it to `false` to restore the tool.

## Browser startup

The tool discovers CDP through `CDP_PORT`, port 9222, or `DevToolsActivePort`. Set `CDP_PORT_FILE` for a non-standard port file.

The `start` action reuses a browser already listening on the configured CDP port. On Linux with a systemd user session, it uses `xdg-settings` to find the graphical desktop's default browser on the selected host. Over SSH, the host's systemd user session must know the graphical desktop environment. The action uses the browser's desktop launch command without creating a separate profile. A browser that does not support CDP may open, but the action reports success only when CDP responds.

Set `CDP_BROWSER` to explicitly choose a compatible executable and `CDP_PROFILE_DIRECTORY` to select a profile. If automatic startup is unsupported or the browser does not expose CDP, start the browser normally and enable remote debugging.

## Boundaries

Keep each result's `ref_id` and element IDs together. Continue truncated output with the returned line, offset or result handle.

Ask before unfamiliar low-trust navigation or consequential external actions such as sending, posting, purchasing, uploading, deleting or changing account settings, unless the user already authorized the action. Never close a shared browser after a task.

The CDP implementation is based on [pasky/chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill).
