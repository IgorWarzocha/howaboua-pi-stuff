# pi-smart-btw

`@howaboua/pi-smart-btw` adds `/btw` side sessions to Pi: async, ephemeral child Pi RPC processes for questions you do not want to derail the main chat. Answers live in the transcript; the widget is status and controls only.

- Fresh context per slot: `pi --mode rpc --no-session` (full tools/extensions; this extension disables itself in the child).
- Multiple numbered slots: `/btw 1 …`, `/btw 2 …`, `/btw` to open the panel, `/btw 1` to switch.
- Per-slot queue and child: a slow slot 1 does not block slot 2.
- Transcript is canonical: display-only `BTW SESSION` entries with generation tombstones on clear/inject.
- Restore from JSONL after restart; restored follow-ups seed the child with prior Q&A when needed.
- BTW entries stay out of the main LLM context until you inject. Old custom-message sessions remain readable.

## Install

```bash
pi install npm:@howaboua/pi-smart-btw
```

One-off:

```bash
pi -e npm:@howaboua/pi-smart-btw
```

## Usage

```text
/btw 1 what is this repo?
/btw 2 explain this error
/btw 1 continue that answer
/btw
```

While a slot is active:

- another `/btw …` (or `/btw N …`) continues that slot's child when targeted
- **alt+c** — inject answers into the main chat and clear the slot
- **alt+x** — clear the slot (hidden tombstone in JSONL)
- **alt+z** — prefill `/btw ` in the editor
- **alt+h/l** — previous/next slot; **alt+1..9** — jump to slot
- **alt+j/k** — fold/unfold the widget
- **/btw config** — settings UI (model, thinking, shortcuts, links)

In **General**: **Edit shortcuts** opens `~/.pi/agent/pi-smart-btw.json` in `$VISUAL` or `$EDITOR`. Use it for shortcuts and advanced JSON-only settings like `command`. Run `/reload` after editing shortcuts. **Esc** closes and saves (merges file + provider/model/thinking).

## Configuration

`~/.pi/agent/pi-smart-btw.json`:

```json
{
  "provider": "openai-codex",
  "modelId": "gpt-5.6-luna",
  "command": "pi",
  "thinking": "low",
  "injectShortcut": "alt+c",
  "dismissShortcut": "alt+x",
  "composeShortcut": "alt+z",
  "foldShortcut": "alt+j",
  "unfoldShortcut": "alt+k",
  "previousShortcut": "alt+h",
  "nextShortcut": "alt+l"
}
```

`thinking` accepts Pi levels through `max` and is clamped to the selected model's capabilities.

## Development

```bash
npm install
npm run check
npm run pack:dry-run
```
