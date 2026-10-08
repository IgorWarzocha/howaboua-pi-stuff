# @howaboua/pi-chill

A source-only starting point for customizing Pi's conversation display. Its folding choices are defaults to adapt, not a universal presentation policy. It is not published to npm.

## Install

```bash
# From a checkout of this repository:
bun install --frozen-lockfile
pi install ./packages/pi-chill
```

Requires Pi 1.1.0 or later. The extension takes effect in the interactive terminal.

Chill starts on. `/chill` toggles the current session immediately, including while working. It does not reload or change saved preferences. Turning it back on folds existing activity again.

Load Chill before Shepherdr, Subdir Agents and Codex Conversion to fold their notices too. Pi uses the first registered message and entry renderers. Earlier extensions keep their own notice presentation.

## Progress

Routine tool calls share a muted block in the conversation: `Working · duration`, then `Worked · duration` when the response settles. A compact row shows current and recent tool names, preferring nested calls over their wrappers. Names fit the terminal width with `+N` for omitted names. Interrupted work says `Stopped`. Nothing is added beside the composer.

While working, an indented line shows the current tool action with its file or command, or a real reasoning heading when supplied. Nested Code and Notebook calls update the same line. There are no generic thinking or writing-status labels. Reasoning and tool activity never share a line. Running tool actions use present tense. Completed actions appear in past tense under `Worked`.

The latest action or heading stays visible until another replaces it, including between tool calls. The same block follows the latest user prompt or visible assistant reply during a run, anchored to the next tool call or supported notice below it. Queued prompts and streamed commentary preserve elapsed time and opened details. Thinking-only and tool-only replies do not move the anchor. Preparation notices before the prompt join the disclosure but never anchor it above the prompt. When a final answer settles without a later activity row, the completed disclosure returns to its last activity position above the answer. While waiting for a new anchor, earlier activity remains accessible through `Ctrl+O` or by turning Chill off. Replies with no activity keep native presentation.

Click the row to show calls in their original order. Click a call to reveal or hide its arguments and original result renderer, including nested Code Mode activity. Pi's tool-expansion shortcut, `Ctrl+O` by default, opens the raw details without needing a mouse. Work settling does not close details you opened.

Tool failures are colored on their activity and detail rows, not on the shared heading. They never force details open. Open the block to inspect calls, or use `Ctrl+O` for their original output. Interrupted runs say `Stopped`. Blocking Pi dialogs stay visible and the activity row says `needs attention`. Inline images remain under their original calls when Pi's image display is enabled.

Shepherdr peer messages, worker questions, failures, completion reports and Subdir Agents instruction notices share the same disclosure. Codex developer messages, context-window notices, Notebook status, toolkit updates and native-compaction notices join it too. Sender identity and actionable worker states remain in the heading. Opening the block reveals notices at their original positions without peer routing envelopes. `Ctrl+O` reveals original content and entry data, including envelopes and complete loaded instructions. Unknown formats retain their full content. Pi still leaves a blank line for each custom notice. Board activity, notes-saved notices, host disconnection notifications and interactive approval dialogs keep native presentation outside the disclosure.

When Chill is on, reasoning bodies and collapsed thinking labels are hidden from chat. Real reasoning headings still update the work block. Pi may leave blank spacing where thinking blocks were. `Ctrl+T` does not reveal reasoning while Chill is on. Turning Chill off restores native reasoning and delegates tool details to their original renderers. Custom notices show full readable content rather than other extensions' compact cards. Activity keeps tracking while off. Your saved thinking preference and stored reasoning are unchanged.

The exact kickoff text `Continue.` and `Continue, unless awaiting for user approval.` also hides when Chill is on. Pi's Markdown hook cannot identify its sender, so identical manually entered text hides too. A native spacer can remain. Other user text and image attachments are unchanged.

Assistant commentary, final answers, and other user messages keep Pi's native presentation. Commentary does not fold into Worked.

`new_context` keeps its original call and result renderer outside the disclosure, including failures. Context rollover is a visible boundary. Activity before and after rollover remains in separate groups.

Restored sessions reconstruct groups from the active branch and mark estimated durations with `~`.

This is presentation only. It adds no model tools, prompt instructions, or model calls, and does not change stored messages. Non-interactive output keeps its original renderers.
