# Suggestions

Suggested next steps in Pi's terminal editor, phrased as requests you can send. Suggestions appear as dim text after a completed response, only while the editor is empty. They are drafts, not automatic follow-up requests.

## Install

```sh
pi install npm:@howaboua/pi-suggestions
```

Requires Pi 1.3 or later. Included in `pi-extensions` and `pi-stuff`.

## Set up

Open `/suggestions`, choose a model and switch suggestions on. They start off, with no model selected. The menu also offers supported reasoning levels, model search and an off switch. These settings are global; they do not change the main chat model.

Suggestions use the selected model's quota and may incur API charges. Each prediction sends that provider a bounded text excerpt of the current conversation, including a compaction summary when available. It excludes tool results, images and hidden reasoning. Predictions use separate requests without tools and do not enter chat history.

## Use

- **Right arrow** accepts the visible suggestion into the editor. Fill any placeholders, edit normally and press **Enter** to send.
- **Tab** keeps Pi's normal behaviour.
- **Escape** dismisses it. Typing replaces it with your own input.
- **Enter** alone never submits a suggestion.

Input, navigation, new responses and blocking dialogs cancel pending suggestions. Long suggestions are visually shortened to fit the editor; accepting inserts the complete draft.

Suggestions require the standard empty editor layout. Custom editors with a different layout remain usable but may not display suggestions. Settings are stored in `suggestions/config.json` under Pi's agent directory.
