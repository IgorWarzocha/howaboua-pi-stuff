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
- `/gippity create` — plan and build a custom LAN web app
- `/gippity setup` — configure audio devices

Settings live in `~/.pi/agent/pi-gippity-control.json`. Keybind changes take effect after `/reload`.

Set a **Voice context model** to seed realtime from Pi's readable history. **Refresh realtime voice after compaction** then pauses at each successful compaction boundary, summarizes the compacted branch, and starts a fresh voice call without ending spoken mode. An initial summarization failure leaves the old call untouched.

`lan.customWebAppPath` controls the app's scope. Use an absolute path for one global app in every Pi directory, or a relative path resolved from the active Pi session cwd for a project-specific app. It must point to a static directory containing `index.html`; the running server rereads it on refresh. `lan.port` is optional and defaults to `43120`.

Companion extensions can register one built static app through `registerGippityRemoteApp`. GipPity serves it under `/_gippity/apps/<id>/` alongside the main remote UI, replays its bounded `app.state` snapshot on browser reconnect, and forwards transient `app.event` messages through the existing mini-SDK. The app still uses `GippityRemote` for activity, Pi events, prompts, drafts, voice, and reconnection; extensions must not start another server.

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
