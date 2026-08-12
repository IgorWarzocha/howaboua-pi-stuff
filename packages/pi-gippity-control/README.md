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
| Mute realtime microphone | `Ctrl+Alt+M` |
| Hold to dictate | `Ctrl+Alt+D` |
| LAN control server | `Ctrl+Alt+G` |

Commands:

- `/gippity` — settings
- `/gippity realtime`
- `/gippity mute`
- `/gippity dictation`
- `/gippity stop`
- `/gippity server`

Settings live in `~/.pi/agent/pi-gippity-control.json`. Keybind changes take effect after `/reload`.

The LAN server includes a microphone mute button. The host retains the Realtime WebRTC call and relays 24 kHz mono audio to the active browser, so moving between devices does not restart the voice session. The server is unauthenticated by design for trusted networks, uses a local HTTPS certificate, belongs only to the Pi session that started it, and stops when that session changes.

The global realtime prompt lives at `~/.pi/agent/REALTIME-SYSTEM-PROMPT.md`; trusted projects can append `.pi/REALTIME-SYSTEM-PROMPT.md`. GipPity ships its current template and cumulative schema changelog as raw Markdown. It checks the marker only when realtime voice is engaged and asks your agent to migrate outdated customized prompts instead of rewriting them automatically. Both paths are shown in `/gippity`.

Other Pi extensions can ask an active voice session to speak:

```ts
import { reportRealtimeVoicePrompt } from "@howaboua/pi-gippity-control";

const announcement = {
	id: "my-extension:finished",
	prompt: "Briefly tell the user that the task finished.",
};
reportRealtimeVoicePrompt(pi, { ...announcement, active: true });
reportRealtimeVoicePrompt(pi, { ...announcement, active: false });
```

For an ongoing state, send `active: true` when it begins and `active: false` when it ends. For a one-off announcement, send both immediately as above.
