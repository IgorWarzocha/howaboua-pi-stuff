# @howaboua/pi-gpt-switcher

Pi extension adding quick model commands:

| Command | Model |
| --- | --- |
| `/sol [reasoning]` | `openai-codex/gpt-5.6-sol` |
| `/terra [reasoning]` | `openai-codex/gpt-5.6-terra` |
| `/luna [reasoning]` | `openai-codex/gpt-5.6-luna` |

Reasoning defaults to `high`. Valid arguments are `off`, `minimal`, `low`,
`medium`, `high`, `xhigh`, and `max`; for example, `/luna low`.

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

Reasoning defaults to `high`. Pi clamps the requested level automatically if
the selected model supports fewer levels.

## Local development

Load the checkout directly:

```sh
pi -e ./index.ts
```
