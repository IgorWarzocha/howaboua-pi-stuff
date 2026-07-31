# pi-codex-conversion

If you're expecting details about the code, you've come to the wrong place. Clone it and ask your Clanka.

Pi already runs GPT models. This extension gives them Codex-shaped tools and prompt handling, then adds web, images, voice, compaction and OpenAI controls without turning the provider request into a schema landfill.

For the argument and token numbers, read [How I gave Pi 17 tools without loading 17 schemas](https://howaboua.dev/writing/how-i-gave-pi-17-tools-without-loading-17-schemas/). This README is for using the thing.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

Requires Pi 0.82 or newer and Node.js 22.19 or newer. Native helpers for macOS, Linux and Windows are bundled for x64 and arm64.

Open `/codex` after installation. The defaults give Codex-like GPT models the structured adapter and leave Code Mode, heavy prompt overwrite and native compaction opt-in. All of them are highly recommended, though. That's what I'm daily-driving and fine-tuning towards.

## Contents

- [What you get](#what-you-get)
- [Modes](#modes)
- [Settings](#settings)
- [Code Mode and custom tools](#code-mode-and-custom-tools)
- [Voice, dictation and GipPity](#voice-dictation-and-gippity)
- [Models and providers](#models-and-providers)
- [Migrating from Lite](#migrating-from-lite)
- [Troubleshooting](#troubleshooting)

## What you get

- Codex-shaped `exec_command`, `write_stdin`, `apply_patch`, `view_image`, `web_run` and `imagegen` tools
- GPT-5.6 Code Mode with only `exec` and `wait` added by the conversion at provider level
- foreground, background and interactive shell sessions with resumable output
- web search, page navigation, image generation/editing and image descriptions for blind models
- realtime voice, push-to-dictate and the GipPity LAN remote mini WebUI
- OpenAI verbosity, fast mode, cached transport, usage, reset credits and Responses compaction
- compact Pi-native rendering, status and background-shell controls

Pi keeps its sessions, project context, skills and UI. The model gets the dialect it already knows.

## Modes

| Mode | Behaviour |
| --- | --- |
| **Structured adapter** | Replaces Pi's default file and shell tools with the Codex-shaped set. This is the default for Codex-like GPT models and configured providers. |
| **Code Mode** | Exposes `exec` and `wait`; shell, patch, image, web and custom tools compose locally inside `exec`. |
| **Extra tools only** | Adds individually selected `apply_patch`, `view_image`, `web_run` or `imagegen` tools without replacing the active model's normal setup. |
| **Voice only** | Leaves the active model's prompt, tools, requests, compaction and adapter widgets untouched while retaining voice and dictation. |

Structured mode has no separate text `read`, `edit` or `write` tool. The model inspects files through the shell and edits with `apply_patch`.

Provider scope can stay on **Codex and configured**, expand to **all providers**, or use **extra tools only**.

## Settings

`/codex` opens the settings UI:

| Tab | Covers |
| --- | --- |
| General | Extension mode, provider scope, configured providers and heavy prompt overwrite |
| Tools | Code Mode, web, images, text image descriptions and activate-only tools |
| OpenAI | Fast mode, verbosity, transport, Responses Lite and compaction |
| Display | Statusline, tool rendering, Code Mode detail and background shells |
| Voice | LAN server, voice, dictation behaviour, shortcuts and prompt paths |
| Usage | Codex limits, reset times and banked reset credits |
| About | GitHub, changelog, Discord and issue links |

Open a tab directly with `/codex tools`, `/codex openai`, `/codex display`, `/codex voice`, `/codex usage` or `/codex about`.

Settings live in `~/.pi/agent/pi-codex-conversion.json`. **Edit config** opens the file for provider IDs, audio devices, custom binaries and keybinds. Run `/reload` after changing keybinds by hand.

`tools.customRustBinariesDir` can override any bundled native helper by filename, including `exec_bridge`, `apply_patch`, `view_image`, `web_run`, `imagegen` and `pi-codex-voice`. Build helpers on the target machine, collect the needed binaries in one directory, set that directory in the config, then run `/reload`.

The optional **Heavy system prompt overwrite** removes roughly 40% of Pi's known default scaffold while preserving additions from other extensions. It is off by default.

## Code Mode and custom tools

Enable **GPT-5.6 Code Mode** in `/codex` → **Tools**. It currently supports OpenAI Codex Luna, Terra and Sol. Configured OpenAI Responses-compatible providers can also use those model IDs or the GPT-5.6 alias with **Proxy Responses Lite** enabled. Other models stay on structured tools.

The model can compose tools in one freeform JavaScript cell:

```js
const status = await tools.exec_command({ cmd: "git status --short" });
text(status);
```

Pi tools that genuinely need Pi's UI remain ordinary tools. `ask` is the obvious example; pretending an interactive questionnaire is a shell command would be daft.

Custom tools are top-level TOML definitions plus a command that accepts one string. Put them in:

```text
~/.pi/agent/codex-conversion-custom-tools/
<project>/.pi/codex-conversion-custom-tools/
```

A promoted tool adds one compact usage line to the prompt. A deferred tool adds no tool-specific startup text and remains discoverable through `ALL_TOOLS`. Neither becomes another provider schema. Keep in mind if a tool is deferred, YOU need to remember that it exists and tell your Clanka to invoke it. Otherwise it might never realise it's there.

Working, disabled examples live in [`examples/custom-tools/`](./examples/custom-tools/). They include Herdr coordination, subagents, semantic search, port diagnostics, workflow creation and two lazy skill loaders. See [`CUSTOM-TOOLS.md`](./src/tools/code-mode/CUSTOM-TOOLS.md) for the definition contract.

For skills, keep repository SOPs in normal `.pi/skills/` and general workflows in global `lazy-skills/` behind the example `skills` tool. `--no-skills` is optional. The older additive `more_skills` example remains available if you want to mix & match and still use Pi's skills alongside a bigger catalogue invoked via `more_skills`.

## Voice, dictation and GipPity

Voice uses your Pi OpenAI Codex login independently of the active model. The spoken model handles conversation and routes work; the active Pi session keeps the tools, files and actual job.

Defaults:

- `Ctrl+Alt+Space` toggles realtime voice
- `Ctrl+Alt+M` mutes or unmutes the realtime microphone without ending the call
- `Ctrl+Alt+D` is push-to-dictate; toggle behaviour is available in the Voice tab
- `Ctrl+Alt+G` toggles the GipPity LAN server

If audio devices are not configured, the first start asks the Pi agent to inspect the available endpoints and save the selected IDs. Dictation returns one editable transcript to Pi's input.

The visible realtime prompt lives at `~/.pi/agent/REALTIME-SYSTEM-PROMPT.md`. A trusted project can append `.pi/REALTIME-SYSTEM-PROMPT.md`. Keep coding and project instructions in AGENTS.md rather than duplicating them into the spoken assistant.

The package ships its current prompt template and cumulative schema changelog as raw Markdown. Realtime voice checks the global prompt marker when voice is engaged. If it is outdated, the extension points you and your agent to the changelog instead of rewriting personal customizations automatically. Both paths are shown in the Voice tab.

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

Voice, usage, web search, image generation and text image descriptions can use the Pi OpenAI Codex login while another provider's model remains active. This is how a text-only model can receive a small vision model's plain-text image description without caring how it got there.

Native Responses compaction is intentionally narrower: OpenAI Codex and explicitly configured OpenAI/Codex-compatible passthrough providers only. Unsupported states fail visibly or fall back to Pi compaction rather than silently discarding context.

## Migrating from Lite

`@howaboua/pi-codex-conversion-lite` has graduated into this package. Lite receives one final release and no further updates.

Remove Lite before installing the canonical package; both use the same command and configuration surfaces.

```bash
pi remove npm:@howaboua/pi-codex-conversion-lite
pi install npm:@howaboua/pi-codex-conversion
```

Your existing `~/.pi/agent/pi-codex-conversion.json` continues to load.

This is also a major change for users of the old canonical package. Legacy PATH mode and its package binaries are gone. Old PATH-mode settings normalize to the structured adapter. Use structured tools or Code Mode custom commands instead.

## Troubleshooting

- **Voice cannot find a device:** let the setup turn inspect the endpoints, save the selected device IDs, then start voice again.
- **GipPity cannot open the microphone:** use one of Pi's HTTPS URLs and accept its local certificate. Browsers block microphone access on plain LAN HTTP.
- **Code Mode cannot start:** its pinned host is prepared lazily and honours normal proxy environment variables. Pi reports setup failures instead of hanging the first execution.
- **A helper cannot run on this system:** build it from a checkout on the target machine, put it in `tools.customRustBinariesDir`, then run `/reload`. Do not replace system glibc for this.
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
