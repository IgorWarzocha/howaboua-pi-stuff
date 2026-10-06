# @howaboua/pi-chill

Keep the conversation readable without showing every routine tool call.

## Install

```bash
pi install npm:@howaboua/pi-chill
```

Requires Pi 1.0.4 or later. The extension takes effect in the interactive terminal.

Chill starts on. `/chill` toggles the current session immediately, including while working. It does not reload or change saved preferences. Turning it back on folds existing activity again.

Load Chill before Shepherdr, Subdir Agents and Codex Conversion to fold their notices too. Pi uses the first registered message and entry renderers. Earlier extensions keep their own notice presentation.

## Progress

Routine tool calls share a muted block in the conversation: `Working · duration`, then `Worked · duration` when the response settles. Completed work shows up to two recent tool actions underneath. Interrupted work says `Stopped`. Nothing is added beside the composer.

While working, an indented line shows the current tool action with its file or command, or a real reasoning heading when supplied. Nested Code and Notebook calls update the same line. There are no generic thinking or writing-status labels. Reasoning and tool activity never share a line. Running tool actions use present tense. Completed actions appear in past tense under `Worked`.

The latest action or heading stays visible until another replaces it, including between tool calls. The block is anchored to the first tool call or supported notice after the latest user prompt, including queued prompts during a run. Preparation notices before the prompt join the disclosure but never anchor it above the prompt. If no later activity row exists, those notices remain accessible through `Ctrl+O` or by turning Chill off. Replies with no activity keep native presentation.

Click the row to show calls in their original order. Click a call to reveal or hide its arguments and original result renderer, including nested Code Mode activity. Pi's tool-expansion shortcut, `Ctrl+O` by default, opens the raw details without needing a mouse. Work settling does not close details you opened.

Errors and interrupted calls appear in the shared heading when activity is folded, not as separate call rows. They never force details open. Open the block to inspect calls, or use `Ctrl+O` for their original output. Blocking Pi dialogs stay visible and the activity row says `needs attention`. Inline images remain under their original calls when Pi's image display is enabled.

Shepherdr peer messages, worker questions, failures, completion reports, board notices and Subdir Agents instruction notices share the same disclosure. Codex developer messages, context-window notices, Notebook status, toolkit updates and native-compaction notices join it too. Sender identity and actionable worker states remain in the heading. Opening the block reveals notices at their original positions without peer routing envelopes. `Ctrl+O` reveals original content and entry data, including envelopes and complete loaded instructions. Unknown formats retain their full content. Pi still leaves a blank line for each custom notice. Notes-saved notices, host disconnection notifications and interactive approval dialogs keep native presentation outside the disclosure.

When Chill is on, reasoning bodies and collapsed thinking labels are hidden from chat. Real reasoning headings still update the work block. Pi may leave blank spacing where thinking blocks were. `Ctrl+T` does not reveal reasoning while Chill is on. Turning Chill off restores native reasoning and delegates tool details to their original renderers. Custom notices show full readable content rather than other extensions' compact cards. Activity keeps tracking while off. Your saved thinking preference and stored reasoning are unchanged.

The exact kickoff text `Continue.` and `Continue, unless awaiting for user approval.` also hides when Chill is on. Pi's Markdown hook cannot identify its sender, so identical manually entered text hides too. A native spacer can remain. Other user text and image attachments are unchanged.

Assistant commentary, final answers, and other user messages keep Pi's native presentation. Commentary does not fold into Worked.

Restored sessions reconstruct groups from the active branch and mark estimated durations with `~`.

This is presentation only. It adds no model tools, prompt instructions, or model calls, and does not change stored messages. Non-interactive output keeps its original renderers.
