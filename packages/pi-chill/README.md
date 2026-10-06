# @howaboua/pi-chill

Keep the conversation readable without showing every routine tool call.

## Install

```bash
pi install npm:@howaboua/pi-chill
```

Requires Pi 1.0.4 or later. The extension takes effect in the interactive terminal.

## Progress

Routine tool calls share a muted block in the conversation: `Working · duration`, then `Worked · duration` when the response settles. Completed work shows up to two recent tool actions underneath. Interrupted work says `Stopped`. Nothing is added beside the composer.

While working, an indented line shows the current tool action with its file or command, or a real reasoning heading when supplied. Nested Code and Notebook calls update the same line. There are no generic thinking or writing-status labels. Reasoning and tool activity never share a line. Running tool actions use present tense. Completed actions appear in past tense under `Worked`.

The latest action or heading stays visible until another replaces it, including between tool calls. The block is anchored to the first tool call. Before that call, or in replies without tools, Pi keeps its native presentation rather than adding a separate status display.

Click the row to show calls in their original order. Click a call to reveal or hide its arguments and original result renderer, including nested Code Mode activity. Pi's tool-expansion shortcut, `Ctrl+O` by default, opens the raw details without needing a mouse. Work settling does not close details you opened.

Errors and interrupted calls keep a compact indicator when activity is folded. They never force details open. Click the indicator or use `Ctrl+O` to inspect the original output. Blocking Pi dialogs stay visible and the activity row says `needs attention`. Inline images remain under their original calls when Pi's image display is enabled.

Routine Shepherdr board notices hide their bodies until `Ctrl+O` expands them. Pi still leaves a blank line for each notice. Agent questions, failures and completion reports stay visible.

Assistant commentary, thinking, final answers, and user messages keep Pi's native presentation. **Commentary and thinking do not fold into Worked.** Pi does not expose the rendering control needed to do that cleanly.

Click an individual thinking block to collapse it without changing the default. Pi's `Ctrl+T` toggles all thinking blocks and saves that preference. Collapsed blocks still leave a thinking label. Pi Chill does not change your thinking display setting or hide commentary.

Restored sessions reconstruct groups from the active branch and mark estimated durations with `~`.

This is presentation only. It adds no model tools, prompt instructions, or model calls, and does not change stored messages. Non-interactive output keeps its original renderers.
