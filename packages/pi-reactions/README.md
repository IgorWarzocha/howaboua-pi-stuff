# Pi Reactions

Install with `pi install npm:@howaboua/pi-reactions`. Requires Pi 1.7 and fullscreen mode for mouse interaction.

Click 🫥 below a finished reply to open its reaction picker. Select the same emoji again to remove it.

| Reaction | Meaning                                                  |
| -------- | -------------------------------------------------------- |
| 👍       | OK                                                       |
| 👎       | Reconsider                                               |
| ⬆️       | Push to the existing remote branch, not merge or release |
| 🔍       | Verify the claim or run the check discussed              |

By default, Pi sends reactions as separate context on your next ordinary prompt without changing what you typed. Commands and messages queued during a run leave them pending. Reactions don't interrupt a turn or approve pending tool calls.

## Custom reactions

On first load, Pi Reactions creates `reactions.json` in your Pi agent directory (normally `~/.pi/agent`) with the four defaults. It won't overwrite your edits. Change, add, remove or reorder entries, then run `/reload`.

```json
[
  { "id": "ship", "icon": "🚀", "label": "Ship it" },
  { "id": "simplify", "icon": "✂️", "label": "Simplify", "startTurn": true }
]
```

Use unique IDs and icons. Each icon is one visible glyph. The label goes in the note sent to the agent. Keep an entry's ID when reordering or restyling it. Use a new ID if its meaning changes. An empty list (`[]`) disables reactions without recreating the defaults.

Set `"startTurn": true` on a reaction to send it immediately and start a turn when Pi is idle. Removing a reaction does not start a turn.

To try it from the checkout, run `pi -e ./packages/pi-reactions/src/index.ts`.
