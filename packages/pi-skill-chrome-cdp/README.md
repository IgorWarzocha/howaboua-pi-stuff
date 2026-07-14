# @howaboua/pi-skill-chrome-cdp

Controls a local Chrome-family browser through the Chrome DevTools Protocol. It can inspect rendered pages and authenticated tabs, navigate, click, type, evaluate JavaScript, and capture screenshots.

## Install

```bash
pi install npm:@howaboua/pi-skill-chrome-cdp
```

## Requirements

- Node.js 22 or newer
- Chrome, Chromium, Brave, Edge, or Vivaldi with remote debugging enabled at `chrome://inspect/#remote-debugging`

The bundled CLI is `scripts/cdp.mjs`. It discovers Chrome on `CDP_PORT` or port `9222`, then falls back to `DevToolsActivePort`; set `CDP_PORT_FILE` for a non-standard port-file location.

Use the skill when an agent needs a real rendered page or existing browser state. It includes commands for tab listing, accessibility snapshots, HTML, navigation, network timing, clicks, typing, screenshots, and raw CDP calls.

Based on [`pasky/chrome-cdp-skill`](https://github.com/pasky/chrome-cdp-skill), with Pi packaging and local changes.
