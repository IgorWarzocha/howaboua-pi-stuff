# @howaboua/pi-chill

Keep the conversation readable without showing every routine tool call.

## Install

```bash
pi install npm:@howaboua/pi-chill
```

Requires Pi 1.0.4 or later. The extension takes effect in the interactive terminal.

## Activity

Routine calls share a muted `Activity · duration` row while the agent works. The row becomes `Worked` and folds when the response settles. Interrupted work says `Stopped`.

Click the row to show calls in their original order. Click a call to reveal its arguments and original result renderer, including nested Code Mode activity. Pi's tool-expansion shortcut, `Ctrl+O` by default, opens the raw details without needing a mouse.

Errors remain visible even when activity is folded. Blocking Pi dialogs stay visible and the activity row says `needs attention`. Inline images remain under their original calls when Pi's image display is enabled.

Assistant commentary, thinking, final answers, and user messages keep Pi's native presentation. **Commentary and thinking do not fold into Worked.** Pi does not expose the rendering control needed to do that cleanly.

Restored sessions reconstruct groups from the active branch and mark estimated durations with `~`.

This is presentation only. It adds no model tools, prompt instructions, or model calls, and does not change stored messages. Non-interactive output keeps its original renderers.
