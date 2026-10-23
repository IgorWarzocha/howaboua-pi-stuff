---

description: Fold a long report or list into interactive review
argument-hint: "[report or instructions]"
---

Fold this material into `ask` instead of replying with another long report:

$ARGUMENTS

If no material follows the command, use the most recent lengthy report or structured list in the conversation.

Call `ask` once with one prompt per independently decidable item:
- Keep the title short.
- Preserve concrete evidence, consequences, and recommendations in the body.
- Use the source's natural choices. For review findings, default to Fix, Defer, and Reject.
- Keep coupled points together; do not manufacture decisions from explanatory bullets.

Do not repeat the report before or after the tool call. Once the responses return, summarize the dispositions briefly and continue only when the surrounding task already authorizes action.
