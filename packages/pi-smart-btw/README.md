# @howaboua/pi-smart-btw

Adds `/btw` for questions you do not want to derail the main chat. Each numbered slot runs an async, ephemeral child Pi RPC process. Its answers stay out of the main model context until you inject them.

## Install

```bash
pi install npm:@howaboua/pi-smart-btw
```

## Usage

```text
/btw 1 what is this repo?
/btw 2 explain this error
/btw 1 continue that answer
/btw
```

- `/btw N <question>` sends to slot N.
- `/btw <question>` sends to the active slot.
- `/btw N` switches slots; `/btw` opens the panel.
- Each slot has its own queue and child, so a slow answer in one does not block another.

Answers live in the transcript and survive restarts, but stay outside the main model context until injected. The widget only shows status and controls.

## Controls

- `Alt+C` — inject the active slot's answers into the main chat, then clear it
- `Alt+X` — clear the active slot without injection
- `Alt+Z` — prefill `/btw `
- `Alt+H` / `Alt+L` — previous/next slot
- `Alt+1` … `Alt+9` — jump to a slot
- `Alt+J` / `Alt+K` — fold/unfold the widget
- `/btw config` — model, thinking, shortcut, and link settings

## Configuration

Settings live at `~/.pi/agent/pi-smart-btw.json`. `/btw config` edits provider, model, and thinking. **Edit shortcuts** opens the JSON file in `$VISUAL` or `$EDITOR`; reload after changing shortcuts or advanced options such as `command`. Thinking is clamped to the selected model.
