# @howaboua/pi-gpt-switcher

Pi extension adding quick model commands:

| Command | Model |
| --- | --- |
| `/sol [reasoning]` | `openai-codex/gpt-5.6-sol` |
| `/terra [reasoning]` | `openai-codex/gpt-5.6-terra` |
| `/luna [reasoning]` | `openai-codex/gpt-5.6-luna` |

An explicit reasoning argument overrides the configured default. Valid arguments
are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; for example,
`/luna low`.

## Defaults

On first load, the extension creates `pi-gpt-switcher.json` in Pi's global
agent directory:

```json
{
  "sol": { "contextWindow": 272000, "reasoning": "high" },
  "terra": { "contextWindow": 872000, "reasoning": "high" },
  "luna": { "contextWindow": 472000, "reasoning": "xhigh" }
}
```

Edit the file to change a shortcut's session context window or default
reasoning. Changes apply on the next shortcut invocation and do not alter the
provider catalogue.

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

Pi clamps the requested reasoning level automatically if the selected model
supports fewer levels.

## Local development

Load the checkout directly:

```sh
pi -e ./index.ts
```
