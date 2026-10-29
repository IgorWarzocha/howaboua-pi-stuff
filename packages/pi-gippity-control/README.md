# GipPity Control

Voice and LAN remote control for Pi, without replacing your active model or tools.

Choose Codex Live or an OpenAI Realtime model for spoken conversation, then send tasks to the current Pi session. The Pi session can use any model provider and keeps its existing tools and confirmations.

## Install

```bash
pi install npm:@howaboua/pi-gippity-control
```

Requires Pi 1.0.0 or newer and Node.js 22.19 or newer. Run `/gippity` to choose a voice model and configure audio.

| Voice model                   | Credential                         |
| ----------------------------- | ---------------------------------- |
| `codex-live-1.1`, the default | Pi's legacy `openai-codex` login   |
| `realtime-2.1`                | An OpenAI API key configured in Pi |
| `realtime-2.1-mini`           | An OpenAI API key configured in Pi |

Codex Live uses OAuth through `/login openai-codex`. Dictation also uses this login, independently of the selected voice model. For Realtime, enter the exact, case-sensitive Pi provider name in **API provider** in terminal or LAN voice settings. The default is `openai`. GipPity uses that provider's API key, headers and compatible Realtime endpoint without storing or displaying the key. Configure the provider's Realtime-compatible endpoint in Pi. Missing keys, OAuth credentials and invalid endpoints are rejected without falling back to another account. Changes apply on the next call. Realtime API calls are billed separately through the selected provider. Sign in with ChatGPT does not provide this API access or replace the legacy Codex login.

Do not install this alongside `@howaboua/pi-codex-conversion`; that package already includes GipPity voice control.

## Controls

| Action                   | Default          |
| ------------------------ | ---------------- |
| Realtime voice           | `Ctrl+Alt+Space` |
| Mute realtime microphone | `Ctrl+Alt+M`     |
| Hold to dictate          | `Ctrl+Alt+D`     |
| LAN control server       | `Ctrl+Alt+G`     |

Commands:
- `/gippity` — settings
- `/gippity realtime`
- `/gippity mute`
- `/gippity dictation`
- `/gippity stop`
- `/gippity server`
- `/gippity create` — plan and build a custom LAN web app
- `/gippity setup` — configure audio devices

Settings live at `<pi-agent-directory>/pi-gippity-control.json`, where the directory defaults to `~/.pi/agent` and `PI_CODING_AGENT_DIR` overrides it. Keybind changes take effect after `/reload`.

Choose **Voice model**, **Primary voice** and **Alternate voice** in settings or the LAN UI. Changes apply to the next call without replacing the current call. Codex Live and Realtime keep separate voice choices. Defaults are Cove and Ember for Codex Live, Marin and Cedar for Realtime. With Shepherdr, each voice transfer to another session alternates the voice and gives an arrival greeting. Reconnects and context refreshes keep the current voice.

Codex Live rewrites the current voice conversation interval into a self-contained task before sending it to Pi. **Task delegation model** shows the configured model without a picker. Change `voice.taskDelegationModel` in the JSON configuration to use another `provider/model` value. The default is `openai-codex/gpt-6-luna`. Choose **Task delegation reasoning** separately in terminal or LAN settings. It defaults to `low` and is independent of voice context summarisation. These settings apply only to Codex Live; GPT-Realtime still sends tasks directly through `send_task`.

Realtime models can send a self-contained task to Pi through `send_task`, including relevant decisions and constraints from the voice discussion. If Pi is busy, the task steers its current work. They can also use developer-registered voice tools. To add optional web search, load `@howaboua/pi-codex-web-run`, configure its access and enable **Realtime web search**. Search uses Web Run's configured provider and credentials.

**Refresh realtime voice after compaction** is off by default and requires a **Voice context model**. When enabled, it pauses at each successful compaction boundary, summarises the compacted branch, and starts a fresh voice call without ending spoken mode. An initial summarisation failure leaves the old call untouched.

Set `lan.customWebApp: true` to enable a custom main UI, then set `lan.customWebAppPath`. Use an absolute path for one global app in every Pi directory, or a relative path resolved from the active Pi session cwd for a project-specific app. It must point to a static directory containing `index.html`; the running server rereads it on refresh. `lan.port` is optional and defaults to `43120`.

Companion extensions can register one built static app through `registerGippityRemoteApp`. GipPity serves it under `/_gippity/apps/<id>/` alongside the main remote UI, replays its bounded `app.state` snapshot on browser reconnect, and forwards transient `app.event` messages through the existing mini-SDK. The app still uses `GippityRemote` for activity, Pi events, prompts, drafts, voice, and reconnection; extensions must not start another server. While Pi waits on an extension prompt, activity enters `waiting` with the prompt title and the bundled UI shows **Waiting for you**.

The LAN server includes a microphone mute button. The host retains the Realtime WebRTC call and relays 24 kHz mono audio to the active browser, so moving between devices does not restart the voice session. The server is unauthenticated by design for trusted networks, uses a local HTTPS certificate, belongs only to the Pi session that started it, and stops when that session changes.

The global realtime prompt lives at `<pi-agent-directory>/REALTIME-SYSTEM-PROMPT.md`; trusted projects can append `.pi/REALTIME-SYSTEM-PROMPT.md`. GipPity ships its current template and cumulative schema changelog as raw Markdown. It checks the marker only when realtime voice is engaged and tells you when to ask your agent to migrate an outdated customized prompt instead of rewriting it automatically. Both paths are shown in `/gippity`.

Extensions can expose custom tools to Realtime models with `registerGippityVoiceTool` from `@howaboua/pi-gippity-control`. Register during extension loading with a name, description, parameter schema and execution callback. Each call snapshots its registered tools, so registration changes affect the next call. Ordinary Pi tools are not automatically exposed to the voice model. The [tool definitions](./src/voice/realtime-tools.ts) describe the callback context and JSON results. PCC bundles the same registration API at `@howaboua/pi-codex-conversion/realtime-voice`.

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
