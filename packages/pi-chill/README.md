# @howaboua/pi-chill

Keep the conversation readable without showing every routine tool call.

## Install

```bash
pi install npm:@howaboua/pi-chill
```

Requires Pi 1.0.4 or later. The extension takes effect in the interactive terminal.

## Progress

While the agent works, a muted block above the editor shows `Working · duration` followed by one indented current stage. When the response settles, routine calls fold into a `Worked · duration` row in the conversation, with up to two recent completed tool actions underneath. Interrupted work says `Stopped`.

The current stage is a readable tool action with its file or command, a real reasoning heading when supplied, or `Thinking`. Nested Code and Notebook calls update the same line. Reasoning and tool activity never share a stage label. Running tool actions use present tense. Completed actions appear in past tense under `Worked`.

Click the row to show calls in their original order. Click a call to reveal its arguments and original result renderer, including nested Code Mode activity. Pi's tool-expansion shortcut, `Ctrl+O` by default, opens the raw details without needing a mouse.

Errors remain visible even when activity is folded. Blocking Pi dialogs stay visible and the activity row says `needs attention`. Inline images remain under their original calls when Pi's image display is enabled.

Routine Shepherdr board notices hide their bodies until `Ctrl+O` expands them. Pi still leaves a blank line for each notice. Agent questions, failures and completion reports stay visible.

Assistant commentary, thinking, final answers, and user messages keep Pi's native presentation. **Commentary and thinking do not fold into Worked.** Pi does not expose the rendering control needed to do that cleanly.

Click an individual thinking block to collapse it without changing the default. Pi's `Ctrl+T` toggles all thinking blocks and saves that preference. Collapsed blocks still leave a thinking label. Pi Chill does not change your thinking display setting or hide commentary.

Restored sessions reconstruct groups from the active branch and mark estimated durations with `~`.

This is presentation only. It adds no model tools, prompt instructions, or model calls, and does not change stored messages. Non-interactive output keeps its original renderers.
