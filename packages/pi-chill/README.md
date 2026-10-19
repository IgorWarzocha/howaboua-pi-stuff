# @howaboua/pi-chill

Folds routine tool activity into expandable progress blocks so the conversation stays readable. This is a source-only starting point for customising Pi's display, not a fixed presentation policy. It is not published to npm.

## Install

```bash
# From a checkout of this repository:
bun install --frozen-lockfile
pi install ./packages/pi-chill
```

Requires Pi 1.1.0 or later. The extension takes effect in the interactive terminal.

Chill starts on. `/chill` toggles the current session immediately, including while working. It does not reload or change saved preferences. Turning it back on folds existing activity again.

Load Chill before Shepherdr, Subdir Agents and Codex Conversion to fold their notices too. Extensions loaded earlier keep their own notice presentation.

## Progress

Routine tool calls share a muted block: `Working · duration`, then `Worked · duration` when the response settles. Interrupted work says `Stopped`. The block shows current and recent tools, including nested Code and Notebook calls, with the current file, command or reasoning heading below.

Shepherdr messages and supported extension notices join the same block. Sender names and worker states stay visible. Restored sessions mark estimated durations with `~`.

## Inspect activity

- Click the progress row to show calls in order, then click a call to inspect its arguments and result.
- Use Pi's tool-expansion shortcut, `Ctrl+O` by default, to open raw details without a mouse.
- Tool failures are coloured on individual rows. They do not force details open, so expand the block or use `Ctrl+O` to inspect the error.
- Blocking dialogs stay visible and the activity row says `needs attention`.

Details you open stay open when work finishes. Inline images remain under their original calls when Pi's image display is enabled.

## What stays visible

Assistant commentary, final answers, Board activity, notes-saved notices and host disconnection notifications remain outside the folded block. `new_context` also stays visible, keeping activity on either side of a context rollover separate.

GitHub Actions completion notices stay in place as compact rows. Click a row or use `Ctrl+O` to read the full notification. Other GitHub watch messages keep their native display.

Reasoning bodies are hidden while Chill is on. `Ctrl+T` does not reveal them. Turn Chill off with `/chill` to restore native reasoning display. Your saved thinking preference and stored reasoning are unchanged.

This is presentation only. It adds no model tools, prompt instructions, or model calls, and does not change stored messages. Non-interactive output keeps its original renderers.
