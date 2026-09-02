# pi-codex-conversion

If you're expecting details about the code, you've come to the wrong place. Clone it and ask your Clanka.

Pi already runs GPT models. This extension gives them Codex-shaped tools and prompt handling, then adds voice, compaction and OpenAI controls without turning the provider request into a schema landfill.

For the argument and token numbers, read [How I gave Pi 17 tools without loading 17 schemas](https://howaboua.dev/writing/how-i-gave-pi-17-tools-without-loading-17-schemas/). This README is for using the thing.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

Requires Pi 0.84.4 or newer and Node.js 22.19 or newer. Native helpers for macOS, Linux and Windows are bundled for x64 and arm64.

Open `/codex` after installation. The defaults give Codex-like GPT models the structured adapter and leave Code Mode, heavy prompt overwrite and native compaction opt-in. All of them are highly recommended, though. That's what I'm daily-driving and fine-tuning towards.

## Contents

- [What you get](#what-you-get)
- [Modes](#modes)
- [Settings](#settings)
- [Cache diagnostics](#cache-diagnostics)
- [Code Mode and custom tools](#code-mode-and-custom-tools)
- [Voice, dictation and GipPity](#voice-dictation-and-gippity)
- [Models and providers](#models-and-providers)
- [Migrating from Lite](#migrating-from-lite)
- [Troubleshooting](#troubleshooting)

## What you get

- Codex-shaped `exec_command`, `write_stdin`, `apply_patch` and `view_image` tools
- GPT-5.6 Code Mode with only `exec` and `wait` added by the conversion at provider level
- foreground, background and interactive shell sessions with resumable output
- image descriptions for blind models
- realtime voice, push-to-dictate and the GipPity LAN remote mini WebUI
- OpenAI verbosity, fast mode, cached transport, usage, reset credits and Responses compaction
- compact Pi-native rendering, status and background-shell controls

Pi keeps its sessions, project context, skills and UI. The model gets the dialect it already knows.

Install [`pi-codex-web-run`](../pi-codex-web-run) or [`pi-codex-imagegen`](../pi-codex-imagegen) when you want Codex web search or image generation. They remain ordinary Pi extensions and automatically compose into Code and Notebook Mode.

## Modes

| Mode | Behaviour |
| --- | --- |
| **Structured adapter** | Replaces Pi's default file and shell tools with the Codex-shaped set. This is the default for Codex-like GPT models and configured providers. |
| **Code Mode** | Exposes `exec` and `wait`; shell, patch, image and extension tools compose locally inside `exec`. |
| **Extra tools only** | Adds individually selected `apply_patch` or `view_image` without replacing the active model's normal setup. |
| **Voice only** | Leaves the active model's prompt, tools, requests, compaction and adapter widgets untouched while retaining voice and dictation. |

Structured mode has no separate text `read`, `edit` or `write` tool. The model inspects files through the shell and edits with `apply_patch`.

Provider scope can stay on **Codex and configured**, expand to **all providers**, or use **extra tools only**.

## Settings

`/codex` opens the settings UI:

| Tab | Covers |
| --- | --- |
| General | Settings scope, execution mode, extension mode, providers and heavy prompt overwrite |
| Tools | Image description fallback and standalone tools |
| OpenAI | Fast mode, verbosity, transport, cache diagnostics, Responses Lite and compaction |
| Display | Statusline, tool rendering, Code Mode detail and background shells |
| Voice | LAN server, realtime behaviour, context summarisation, dictation, shortcuts and prompt paths |
| Usage | Codex limits, reset times and banked reset credits |
| About | GitHub, changelog, Discord and issue links |

Open a tab directly with `/codex tools`, `/codex openai`, `/codex display`, `/codex voice`, `/codex usage` or `/codex about`.

The first `/codex` setting chooses **Global** or **This project**. Global settings live in `~/.pi/agent/pi-codex-conversion.json`. Choosing **This project** creates a project snapshot at `.pi/pi-codex-conversion.json`. Every tab and **Edit config** then targets that file. Luna cache keepalive remains global, while Sol and Terra keepalive follows the project. Switching back to Global removes the project overrides. Project settings are read only for trusted folders.

Without folder settings, the project inherits the complete global configuration. `PI_CODEX_FAST=1` or `PI_CODEX_FAST=0` can override Fast Mode for one Pi process, which is useful for independently launched workers. Run `/reload` after changing files by hand.

`tools.customRustBinariesDir` can override any bundled native helper by filename, including `exec_bridge`, `apply_patch`, `view_image` and `pi-codex-voice`. Build helpers on the target machine, collect the needed binaries in one directory, set that directory in the config, then run `/reload`.

The optional **Heavy system prompt overwrite** removes roughly 40% of Pi's known default scaffold while preserving additions from other extensions. It is off by default.

Responses compaction V2 stores an encrypted checkpoint for the Codex lane. If you switch providers inside long sessions, enable **Parallel Pi-native compaction** beside it. Each native compaction then runs Pi's normal cumulative summarizer on an isolated request lane and stores the readable result alongside the encrypted checkpoint. Codex replay keeps using the native checkpoint, while other providers receive the Pi summary. This adds summarization cost, so it is off by default.

## Cache diagnostics

Open `/codex openai` and set **Cache diagnostics** to **Status** or **Status + log**. Diagnostics are off by default.

Pi has one extension-status row, so the existing adapter and optional cache state appear together:

```text
Codex adapter V: low • notebook mode Codex Cache • HIT • WS delta
```

Pi's built-in footer already shows the latest cache percentage. `Codex Cache` instead explains the transport and continuation decision:

| Status | Meaning |
| --- | --- |
| `Codex Cache • waiting` | Enabled; no Codex request observed yet. |
| `Codex Cache • prewarm ready • WS new` | A new WebSocket was prepared successfully. `WS reused` means an existing socket was prepared. |
| `Codex Cache • HIT • WS delta` | OpenAI reported cached input and only continuation input was sent. |
| `Codex Cache • HIT • WS full (body mismatch)` | Delta continuation was unsafe, so the full request was sent, but OpenAI's prompt cache still hit. |
| `Codex Cache • MISS • WS full (input prefix mismatch)` | The history diverged from the continuation baseline and OpenAI reported no cached input. |
| `Codex Cache • WS retry 2` | The first WebSocket attempt failed and the adapter is retrying. |
| `Codex Cache • WS → SSE` | WebSocket recovery ended and the request moved to SSE. |
| `Codex Cache • compaction • HIT • WS delta` | Native compaction reused the active continuation. |
| `Codex Cache • WS failed: authentication • invalid_token • 401` | The request failed; diagnostics expose only safe error metadata. |

A cache miss stays visible for three seconds. Events arriving during that hold are not queued; the row then moves directly to the newest state. WebSocket continuation and OpenAI prompt caching are separate, so `WS full` can still produce a cache hit.

With logging enabled the status gains `• log`. Readable per-session logs go to:

```text
~/.pi/agent/pi-codex-logs/<session-derived-name>.log
```

Logs contain request lane, transport, socket reuse, continuation decision, item counts, cache token counts, retry/fallback state and allowlisted errors. They omit prompts, messages, tool arguments, images, credentials, provider payloads and response IDs.

## Code Mode and custom tools

Select **Code** or **Notebook (recommended)** under `/codex` → **General**. They currently support OpenAI Codex Luna, Terra, Sol, Daybreak Blue and Daybreak Red. Configured OpenAI Responses-compatible providers can also use those model IDs or the GPT-5.6 alias with **Proxy Responses Lite** enabled. Other configured or all-provider routes stay on the structured adapter. Unrelated models retain Pi's ordinary tools.

The model can compose tools in one freeform JavaScript cell:

```js
const status = await tools.exec_command({ cmd: "git status --short" });
text(status);
```

Notebook Mode keeps `exec` and `wait`, adds a top-level `notebook` lifecycle tool, and preserves JavaScript or TypeScript bindings in one persistent Deno runtime. The `notebook` tool owns status, checkpoints, restarts, resets and stored profiles.

### Pi extension API

Pi tools that genuinely need Pi's UI can also appear inside Code and Notebook Mode. Install [`pi-ask`](../pi-ask) and `await tools.ask(...)` opens the same interactive panel from a cell.

Register the tool normally, then adapt the same definition for Code and Notebook Mode:

```ts
import {
	adaptToolForCodeMode,
	registerCodeModeExtensionTools,
} from "@howaboua/pi-codex-conversion/code-mode";

const registration = registerCodeModeExtensionTools(pi, () => [
	adaptToolForCodeMode(tool, { usage: "await tools.example(input)" }),
], {
	isActive: () => extensionRuntime.isActive(),
});
extensionRuntime.onActiveChange(() => registration.refresh());
pi.on("session_shutdown", () => registration.unregister());
```

The complete bundled example at [`examples/code-mode-extension/`](./examples/code-mode-extension) includes the tool, extension entry point and package manifest. Declare `@howaboua/pi-codex-conversion` 3.0.24 or newer as a peer dependency. Import the API lazily when the extension should still work without Pi Codex.

The adapted definition keeps its Pi context, UI, schema and progress updates. JavaScript receives model-usable result content, while the tool's exact result remains available to its ordinary Pi renderer. Code Mode owns the JavaScript call and runs its own nested-tool preflight.
Tool names that are not JavaScript identifiers receive the same translated name in Code and Notebook Mode, including prompt guidance and `ALL_TOOLS`.
Use `toolName` for a non-default Responses namespace and `resultValue` when JavaScript needs a structured value instead of the ordinary model-visible result.
Set `blocking: true` when every call must hold the agent turn until it settles, or pass `blocking: input => boolean` when the choice depends on the invocation. The default allows long-running work to yield to `wait` normally. Set `deferLoading: true` to omit the usage line and expose the tool through `ALL_TOOLS` instead.
For a compact routed string surface, set `kind: "freeform"` and provide `prepareInput` to map that string into the normal Pi tool parameters. Code and Notebook Mode then omit the original JSON schema while execution, rendering and prompt metadata still come from the same tool.
Use the optional `isActive` gate when an extension exposes its tool only in a session mode. Keep returning the tool definition from the provider and call `registration.refresh()` when the mode changes. Code Mode also resamples gates at normal session and input boundaries, then keeps its prompt, nested registry and outer tool filtering fixed through that run.

Shipped integrations provide larger examples:

- [`pi-ask`](../pi-ask) uses a blocking Pi UI tool.
- [`pi-better-skills-tool`](../pi-better-skills-tool) and [`pi-browser`](../pi-browser) map freeform strings into their normal tool parameters.
- [`pi-codex-web-run`](../pi-codex-web-run) and [`pi-codex-imagegen`](../pi-codex-imagegen) use namespaced tool names and structured Code Mode results.
- [`pi-shepherdr`](../pi-shepherdr) uses an activation gate, refreshes its registration when state changes and chooses blocking per call.

### TOML custom tools

Custom tools are top-level TOML definitions plus a command that accepts one string. Put them in:

```text
~/.pi/agent/codex-conversion-custom-tools/
<project>/.pi/codex-conversion-custom-tools/
```

A promoted tool adds one compact usage line to the prompt. A deferred tool adds no tool-specific startup text and remains discoverable through `ALL_TOOLS`. Neither becomes another provider schema. Keep in mind if a tool is deferred, YOU need to remember that it exists and tell your Clanka to invoke it. Otherwise it might never realise it's there.

Working, disabled examples live in [`examples/custom-tools/`](./examples/custom-tools/). They include legacy browser and agent runners, progressive skills, semantic search, port diagnostics, site management and workflow helpers. See [`CUSTOM-TOOLS.md`](./src/tools/code-mode/CUSTOM-TOOLS.md) for the definition contract.

The legacy `skills` example assumes Pi starts with `--no-skills`. Prefer the maintained [`pi-better-skills-tool`](../pi-better-skills-tool) extension.

## Voice, dictation and GipPity

Voice uses your Pi OpenAI Codex login independently of the active model. The spoken model handles conversation and routes work; the active Pi session keeps the tools, files and actual job.

Defaults:

- `Ctrl+Alt+Space` toggles realtime voice
- `Ctrl+Alt+M` mutes or unmutes the realtime microphone without ending the call
- `Ctrl+Alt+D` is push-to-dictate; toggle behaviour is available in the Voice tab
- `Ctrl+Alt+G` toggles the GipPity LAN server

Voice input and output follow the system defaults. Set `voice.inputDevice` or `voice.outputDevice` only to pin an endpoint. Dictation returns one editable transcript to Pi's input.

Fresh installs use Cove for realtime voice and Luna with high reasoning for context summarisation. Realtime calls resume after transport drops, and **Run summarisation** pauses at each successful compaction boundary, summarizes the compacted branch, and starts a fresh voice call without ending spoken mode. An initial summarization failure leaves the old call untouched.

The visible realtime prompt lives at `~/.pi/agent/REALTIME-SYSTEM-PROMPT.md`. A trusted project can append `.pi/REALTIME-SYSTEM-PROMPT.md`. Keep coding and project instructions in AGENTS.md rather than duplicating them into the spoken assistant.

The package ships its current prompt template and cumulative schema changelog as raw Markdown. Realtime voice checks the global prompt marker when voice is engaged. If it is outdated, the extension points you and your agent to the changelog instead of rewriting personal customizations automatically. Both paths are shown in the Voice tab.

Other Pi extensions can ask an active voice session to speak:

```ts
import { reportRealtimeVoicePrompt } from "@howaboua/pi-codex-conversion/realtime-voice";

const announcement = {
	id: "my-extension:finished",
	prompt: "Briefly tell the user that the task finished.",
};
reportRealtimeVoicePrompt(pi, { ...announcement, active: true });
reportRealtimeVoicePrompt(pi, { ...announcement, active: false });
```

For an ongoing state, send `active: true` when it begins and `active: false` when it ends. For a one-off announcement, send both immediately as above.

Voice commands:

```text
/codex voice realtime
/codex voice mute
/codex voice dictation
/codex voice stop
/codex voice server
```

`/codex voice server` lazily starts GipPity over HTTPS and prints its hostname and LAN addresses. Open one on a different machine (phone, cough, cough) and accept the local certificate on first visit. Amazing when using a devbox without a mic or when you want to Tailscale into Pi and talk to it remotely.

GipPity provides realtime voice with a microphone mute button, editable dictation drafts, typed prompting, Pi activity and settled assistant results. The host retains the Realtime WebRTC call and relays 24 kHz mono audio to the active browser, so moving between devices does not restart the voice session. It follows the Pi theme and can be saved as a PWA / phone app.

The server belongs only to the Pi session that started it and stops when that session changes. There is intentionally no authentication in v1; it is for a trusted LAN.

## Models and providers

The default scope activates conservatively for Codex-like GPT routes and Responses providers listed under **Additional providers**. Switching to an unrelated model restores Pi's ordinary tools.

Voice, usage and text image descriptions can use the Pi OpenAI Codex login while another provider's model remains active. The standalone web and image-generation extensions use the same login independently.

Native Responses compaction is intentionally narrower: OpenAI Codex and explicitly configured OpenAI/Codex-compatible passthrough providers only. Unsupported states fail visibly or fall back to Pi compaction rather than silently discarding context. A portable summary must be enabled before the native checkpoint that you want to carry across providers.

## Migrating from Lite

`@howaboua/pi-codex-conversion-lite` has graduated into this package. Lite receives one final release and no further updates.

Remove Lite before installing the canonical package; both use the same command and configuration surfaces.

```bash
pi remove npm:@howaboua/pi-codex-conversion-lite
pi install npm:@howaboua/pi-codex-conversion
```

Your existing `~/.pi/agent/pi-codex-conversion.json` continues to load.

Web search and image generation are now independently installed extensions:

```bash
pi install npm:@howaboua/pi-codex-web-run
pi install npm:@howaboua/pi-codex-imagegen
```

This is also a major change for users of the old canonical package. Legacy PATH mode and its package binaries are gone. Old PATH-mode settings normalize to the structured adapter. Use structured tools or Code Mode custom commands instead.

## Troubleshooting

- **Voice cannot find a device:** let the setup turn inspect the endpoints, save the selected device IDs, then start voice again.
- **GipPity cannot open the microphone:** use one of Pi's HTTPS URLs and accept its local certificate. Browsers block microphone access on plain LAN HTTP.
- **Code Mode cannot start:** its pinned host is prepared lazily and honours normal proxy environment variables. Pi reports setup failures instead of hanging the first execution.
- **A bundled helper cannot run on this system:** build the core helper from a checkout on the target machine, put it in `tools.customRustBinariesDir`, then run `/reload`. Do not replace system glibc for this. Web search and image generation are TypeScript extensions and need no platform helper.
- **A configured provider fails:** it must implement the OpenAI Responses contracts required by the enabled feature. Code Mode additionally needs Responses Lite compatibility; native compaction needs the Codex compaction contract.

For anything stranger, clone the repository and ask your Clanka:

```bash
git clone https://github.com/IgorWarzocha/howaboua-pi-stuff.git
cd howaboua-pi-stuff
bun install
pi --no-extensions --no-skills -e ./packages/pi-codex-conversion
```

See [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md), [`CHANGELOG.md`](./CHANGELOG.md) and [GitHub issues](https://github.com/IgorWarzocha/howaboua-pi-stuff/issues).

## License

MIT. Bundled and vendored third-party components retain their own licences and notices.
