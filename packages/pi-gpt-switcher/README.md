# @howaboua/pi-gpt-switcher

Pi extension adding quick model commands:

| Command              | Model                        |
| -------------------- | ---------------------------- |
| `/sol [reasoning]`   | `openai-codex/gpt-6.2-sol`   |
| `/terra [reasoning]` | `openai-codex/gpt-6.1-terra` |
| `/luna [reasoning]`  | `openai-codex/gpt-6-luna`    |
| `/astra [reasoning]` | `openai-codex/gpt-6.2-astra` |

An explicit reasoning argument overrides the configured default. Valid arguments
are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; for example,
`/luna low`.

## Defaults

On first load, the extension creates `pi-gpt-switcher.json` in Pi's global
agent directory:

```json
{
	"sol": { "contextWindow": 500000, "reasoning": "high" },
	"terra": { "contextWindow": 500000, "reasoning": "high" },
	"luna": { "contextWindow": 500000, "reasoning": "xhigh" },
	"astra": { "contextWindow": 256000, "reasoning": "low" }
}
```

Edit the file to change a shortcut's session context window or default
reasoning. Changes apply on the next shortcut invocation and do not alter the
provider catalogue. Context windows must be safe integers of at least 128k.
Values above the shortcut's default are accepted. Set a window supported by
your provider; this setting changes Pi's budget, not the provider's capacity.

Existing context and reasoning settings are preserved. Edit existing context windows to adopt the new defaults. Omitted shortcuts use their shipped defaults, and unknown entries are ignored.

## Install

```bash
pi install npm:@howaboua/pi-gpt-switcher
```

Try it for one session:

```bash
pi -e npm:@howaboua/pi-gpt-switcher
```

## How it works

The commands use Pi's model registry and normal provider authentication. If a
model is unavailable or the OpenAI Codex credentials are missing, the command
reports that instead of changing the current model.

GPT-6.2 shortcuts work with Pi's built-in Codex provider without another extension.
An extension-supplied native Codex provider keeps control of its model catalogue.

Pi clamps the requested reasoning level automatically if the selected model
supports fewer levels.

## Local development

Load the checkout directly:

```sh
pi -e ./index.ts
```
