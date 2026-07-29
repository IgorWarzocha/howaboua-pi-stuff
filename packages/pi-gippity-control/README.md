# GipPity Control

Voice and LAN remote control for Pi, without replacing your active model or tools.

GipPity uses an OpenAI Codex login for its realtime audio connection, then routes work into the current Pi session. The Pi session can use any model provider.

## Install

```bash
pi install npm:@howaboua/pi-gippity-control
```

Log into `openai-codex` in Pi, then run `/gippity`.

Do not install this alongside `@howaboua/pi-codex-conversion`; that package already includes GipPity voice control.

## Controls

| Action | Default |
| --- | --- |
| Realtime voice | `Ctrl+Alt+Space` |
| Hold to dictate | `Ctrl+Alt+D` |
| LAN control server | `Ctrl+Alt+G` |

Commands:

- `/gippity` — settings
- `/gippity realtime`
- `/gippity dictation`
- `/gippity stop`
- `/gippity server`

Settings live in `~/.pi/agent/pi-gippity-control.json`. Keybind changes take effect after `/reload`.

The LAN server is unauthenticated by design for trusted networks, uses a local HTTPS certificate, belongs only to the Pi session that started it, and stops when that session changes.
