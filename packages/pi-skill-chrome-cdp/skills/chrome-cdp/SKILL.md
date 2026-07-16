---
name: chrome-cdp
description: "Chrome CDP inspection/control: rendered pages, authenticated tabs, navigation, interaction, DOM/accessibility state, network, screenshots. Use when browser-rendered evidence or existing browser state matters."
---

# Chrome CDP

## Authorization

Treat the user's request and applicable repository or environment instructions as authorization for browser operations reasonably needed to complete the task. Do not ask again merely because CDP is involved.

Proceed without separate confirmation for:

- opening or navigating established public sites relevant to the task
- reading, searching, filtering, or opening content, including routine search forms and logged-in pages when authentication is needed to find what the user requested
- reversible interface actions that do not publish, communicate, purchase, delete, or change account state

Ask before navigating the user's browser to an unfamiliar or low-trust site they did not identify. Also ask before consequential external actions such as sending or posting content, reacting publicly, submitting applications or other consequential forms, purchasing, uploading, deleting, or changing account settings—unless the user explicitly authorized it or it follows directly from an action you already agreed to take. Once authorized, act without a redundant confirmation.

## Command path

The CLI lives next to this skill at `scripts/cdp.mjs`. Resolve it relative to this `SKILL.md` file, or use the installed package path if your host exposes one.

## Prerequisites

- Chrome (or Chromium, Brave, Edge, Vivaldi) with remote debugging enabled: open `chrome://inspect/#remote-debugging` and toggle the switch
- Node.js 22+ (uses built-in WebSocket)
- The CLI first tries HTTP discovery on `CDP_PORT` or `9222` for deterministic access to the logged-in browser
- If that fixed-port discovery fails, it falls back to `DevToolsActivePort`; set `CDP_PORT_FILE` if the file is in a non-standard location

## Commands

All commands use `scripts/cdp.mjs`. The `<target>` is a **unique** targetId prefix from `list`; copy the full prefix shown in the `list` output (for example `6BE827FA`). The CLI rejects ambiguous prefixes.

### List open pages

```bash
scripts/cdp.mjs list
```

### Take a screenshot

```bash
scripts/cdp.mjs shot <target> [file]             # viewport; default: screenshot-<target>.png in runtime dir
scripts/cdp.mjs shotel <target> <selector> [file] # one element/div by CSS selector, with built-in 10px padding
```

`shot` captures the **viewport only**. `shotel` scrolls the selected element into view and captures only its visible bounding box plus 10px padding. Keep it simple: use a stable CSS selector; no extra padding/size params. Output includes the page's DPR and coordinate conversion hint (see **Coordinates** below).

### Accessibility tree snapshot

```bash
scripts/cdp.mjs snap <target>
```

### Evaluate JavaScript

```bash
scripts/cdp.mjs eval <target> <expr>
```

> **Watch out:** avoid index-based selection (`querySelectorAll(...)[i]`) across multiple `eval` calls when the DOM can change between them (e.g. after clicking Ignore, card indices shift). Collect all data in one `eval` or use stable selectors.

### Other commands

```bash
scripts/cdp.mjs html    <target> [selector]   # full page or element HTML
scripts/cdp.mjs nav     <target> <url>         # navigate and wait for load
scripts/cdp.mjs net     <target>               # resource timing entries
scripts/cdp.mjs click   <target> <selector>    # click one visible element by unique CSS selector
scripts/cdp.mjs clickxy <target> <x> <y>       # click at CSS pixel coords
scripts/cdp.mjs type    <target> <text>         # type at verified editable focus; supports focused cross-origin iframes
scripts/cdp.mjs loadall <target> <selector> [ms]  # click "load more" until gone (default 1500ms between clicks)
scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
scripts/cdp.mjs open    [url]                  # open new tab; Chrome may show an Allow prompt
scripts/cdp.mjs stop    [target]               # stop daemon(s)
```

## Coordinates

`shot` saves an image at native resolution: image pixels = CSS pixels × DPR. CDP Input events (`clickxy` etc.) take **CSS pixels**.

```
CSS px = screenshot image px / DPR
```

`shot` prints the DPR for the current page. Typical Retina (DPR=2): divide screenshot coords by 2.

## Tips

- Prefer `snap` over `html` when you want page structure instead of raw markup; this CLI already uses the compact accessibility snapshot mode.
- Use a unique selector for `click`; it rejects ambiguous, hidden, disabled, or non-interactable matches.
- Use `type` (not eval) to enter text. Focus a visible editable control with `click` or `clickxy` first; `type` fails when no editable control is focused and labels cross-origin iframe input as unverified.
- Chrome may show an "Allow debugging" modal when a tab is first attached. A background daemon keeps the session alive afterward and auto-exits after 20 minutes of inactivity.
