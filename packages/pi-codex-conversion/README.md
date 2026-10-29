# pi-codex-conversion

If you're expecting details about the code, you've come to the wrong place. Clone it and ask your Clanka.

Pi already runs GPT models. This extension gives them Codex-shaped tools and prompt handling, then adds voice, compaction and OpenAI controls without turning the provider request into a schema landfill.

For the argument and token numbers, read [How I gave Pi 17 tools without loading 17 schemas](https://howaboua.dev/writing/how-i-gave-pi-17-tools-without-loading-17-schemas/). This README is for using the thing.

## What you get

- Codex-shaped shell, patch and image tools
- tools exposed directly, composed in one-shot code, or used through persistent Deno, TypeScript and JavaScript notebooks
- foreground, background and interactive shell sessions with resumable output
- image descriptions for blind models
- realtime voice, push-to-dictate and a remote voice interface for your phone or browser
- OpenAI reasoning, verbosity, fast mode, cache controls, usage and compaction
- compact Pi-native rendering, status and background-shell controls

Pi keeps its sessions, project context, skills and UI. The model gets the dialect it already knows.

Install [Web Run](../pi-codex-web-run) or [Imagegen](../pi-codex-imagegen) for web search or image generation.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

Requires Pi 1.4.0 or newer and Node.js 22.19 or newer. Native helpers for macOS, Linux and Windows are bundled for x64 and arm64. TS Notebook has [narrower platform support](#code-mode-and-custom-tools).

Open `/codex` after installation. Codex-like GPT models use **Structured** mode by default.

**My recommended setup:** select **Notebook** under **General**, enable **Heavy system prompt overwrite**, and choose **Codex V2** compaction under **Context**. These are opt-in, but they're what I'm daily-driving and fine-tuning towards.

## Reference

<a name="modes"></a>

<details>
<summary><strong>Modes</strong></summary>

Choose an execution mode under `/codex` → **General**:

| Mode | How the model uses tools |
| --- | --- |
| **Structured** | Calls tools directly through top-level JSON schemas. |
| **Code** | Composes tools in one-shot JavaScript cells through `exec`, with `wait` for longer work. |
| **Notebook** | Uses a persistent Deno notebook with JavaScript and TypeScript support. |
| **TS** | Uses a persistent TypeScript notebook with strict checking before execution and Node APIs. |
| **JS Notebook** | Uses a persistent JavaScript notebook that saves the full live state, including closures and class instances. |

Code starts fresh for each cell. All three notebook modes retain state between cells and provide notebook management controls. They differ in runtime access and what can be restored after a restart. See [notebook modes](#code-mode-and-custom-tools) below.

Execution mode is separate from provider scope. Apply the adapter to **Codex and configured** providers or **all providers**. **Extra tools only** adds selected patch and image tools without replacing the normal setup. **Voice only** keeps voice and dictation without changing the model's tools or requests.

The Codex toolset reads files through the shell and edits with `apply_patch`, rather than Pi's separate text read, edit and write tools.

</details>

<a name="settings"></a>

<details>
<summary><strong>Settings</strong></summary>

`/codex` saves changes immediately. Changes made during a run apply after it settles. Voice stop, mute and server controls remain immediate.

| Tab | Covers |
| --- | --- |
| General | Settings scope, execution mode, providers, prompt overwrite, time reminders |
| Context | Compaction method and retained user messages |
| Tools | Auto reasoning, image descriptions, standalone tools |
| OpenAI | Fast and Ultrafast modes, Daybreak, verbosity, transport, diagnostics, Responses Lite |
| Display | Statusline, tool rendering, note save markers, background shells |
| Voice | Realtime voice, remote access, summarisation, dictation, shortcuts, prompt paths |
| Usage | Spend by model and reset window, Codex limits, reset credits |
| About | GitHub, changelog, Discord, issues |

Open a tab directly with commands such as `/codex tools`, `/codex openai` or `/codex voice`.

### Global or project settings

The first setting chooses **Global** or **This project**. Global settings live in `~/.pi/agent/pi-codex-conversion.json`. Project settings create a snapshot at `.pi/pi-codex-conversion.json`, read only in trusted folders.

Switching back to Global removes the project's overrides. Run `/reload` after editing configuration files by hand.

### Optional controls

- **Heavy system prompt overwrite:** **on** trims Pi's default instructions while preserving other extensions' additions. **GPT (experimental)** uses denser guidance. Off by default.
- **Current time reminders:** adds periodic time updates for the model. Choose 30 or 60 minutes under General. Off by default.
- **Auto reasoning:** asks supported GPT-6 models to adjust effort during work, never below your selected level. Your selection returns when the run settles. Off by default. The model can ignore the instruction, so this is not a guarantee of adaptive effort.
- **Fast Mode:** choose off, priority processing or Ultrafast independently for Astra, Sol, Terra and Luna. Availability depends on the model and account.
- **Daybreak:** requests the connected account's available Daybreak access program without changing the selected model. Requests stop if support cannot be confirmed. See [OpenAI's Daybreak guide](https://developers.openai.com/api/docs/guides/daybreak).

### Usage and quota

`/codex usage` shows recorded tokens, API-equivalent spend, Codex limits and reset credits. These dollar values are estimates, not subscription charges. Quota shares are approximate because other apps and devices can use the same allowance. Renamed providers and custom endpoints carry an accuracy warning.

`/codex usage analyse` asks your agent to inspect longer-term trends and reasoning levels. Tracking is local and stores no conversation content. The first view imports available session costs, but cannot recover missing calls or exact historical reset times.

When ordinary quota runs out, eligible accounts may receive **Luna Reserve**. PCC switches only after backend authorisation and asks you to send `continue`. It does not redeem reset credits automatically. Your original model returns after ordinary quota recovers, unless you choose another model first.

</details>

<a name="context-management"></a>

<details>
<summary><strong>Context management</strong></summary>

Choose under `/codex context`:

| Method | What survives compaction |
| --- | --- |
| **Pi summary** | A readable summary. Default. |
| **Codex V2** | An encrypted OpenAI checkpoint and recent user messages. |
| **Both** | The checkpoint plus a readable summary, at extra summarisation cost. |

V2 can preserve 16k, 32k or 64k of recent user messages verbatim. The default is 64k. This is not the total context limit.

V2 and Both require Codex or a configured compatible passthrough. **Choose Both before creating a checkpoint you need across providers, or convert to Pi summary before switching.** Other routes use Pi summary without erasing your saved method.

For notes, history, context-window rollover and shared agent context, install [Notes Compaction](../pi-notes-compaction/README.md) and configure it under `/notes`. These are not built into PCC. Existing Notes-enabled PCC configurations require Notes to be loaded or that old continuity setting to be explicitly disabled.

</details>

<a name="cache-diagnostics"></a>

<details>
<summary><strong>Cache and diagnostics</strong></summary>

Pi's footer shows cache percentage. Enable **Codex diagnostics** under `/codex openai` for connection status:

| Status | Meaning |
| --- | --- |
| `HIT • WS delta` | Cached input reported and only continuation input sent |
| `HIT • WS full` | A full request was needed, but the prompt cache still hit |
| `MISS` | No cached input reported |
| `WS retry` | Retrying the WebSocket connection |
| `WS → SSE` | Switched to SSE after WebSocket recovery |

**Prompt caching and WebSocket continuation are separate.** A full request can still hit the cache.

**Status + log** writes diagnostic files to `~/.pi/agent/pi-codex-logs/`. They include usage, timings, retries and safe error metadata, but exclude prompts, tool arguments, images and credentials. These logs are useful when reporting a problem.

**Keepalive uses quota while idle and does not guarantee cache retention.** It is off by default. Astra, Sol and Terra offer per-project request intervals of 25 or 55 minutes. Luna has a global duration of 5, 10 or 15 minutes, with requests every 2.5 or 4.5 minutes until that duration expires.

</details>

<a name="code-mode-and-custom-tools"></a>

<details>
<summary><strong>Notebook modes and custom tools</strong></summary>

Code and Deno download their runtimes on first use. TS and JS Notebook reuse matching installed packages or download them with npm. First use needs registry access when packages are missing. Cached runtimes work offline, and unselected modes do not download anything.

Ask your agent to inspect, save, load or clean up notebook state. The `notebook` tool provides its own action help. **Restart and cancellation do not undo file changes or other external tool effects.**

### Deno Notebook

The **Notebook** setting provides persistent JavaScript and TypeScript with Deno APIs, imports, checkpoints, project pins and named profiles. It also supports startup and tool-result hooks for reusable automation.

After a normal cell yields, `isolated:true` cells can run in separate Deno kernels from the last completed checkpoint. Up to four isolated cells can run at once. They save named profile candidates without changing live state. Loading a candidate adds its saved bindings and rejects name collisions, rather than replacing the notebook. Only checkpoint-supported state transfers. Recreate imports, closures and live handles when needed.

### TS Notebook

Select **TS** for strict TypeScript checking, retained type declarations, Node and Web APIs, and imports from local files or packages. Invalid code and tool arguments are rejected before execution. New npm dependencies require user approval.

Run Pi under Node on Linux or macOS with x64 or arm64, or Windows x64.

Variables, closures, class instances and module state survive between cells. Checkpoints save supported data and helpers, reporting anything that remains live-only. Custom snapshot and restore helpers can preserve additional objects. Restart restores the checkpoint, not arbitrary live-only state.

Concurrent isolated cells start from the last checkpoint and save separate candidates. Loading one replaces the live notebook rather than automatically merging changes. Releasing bindings also rebuilds the kernel and clears live-only values.

### JS Notebook

Select **JS Notebook** for JavaScript with full-state checkpoints, including closures, private class fields, aliases and cycles. The notebook is shared across conversations in the same project.

Run Pi under Node. The notebook has no Node APIs, imports, direct network access or TypeScript checking. The agent uses tools for host operations.

Normal cells run serially and save the full state. Restart restores that checkpoint. Releasing a name makes it reusable without changing values captured by existing closures. Reset affects the shared project notebook, while preserving pinned data and named profiles.

After a normal cell yields, isolated cells can run while it is still running. Each starts from the latest committed checkpoint, not the normal cell's unfinished changes, and saves a separate candidate without changing the live notebook. External tool and file effects remain shared.

Whole-notebook profiles and isolated candidates replace the live state when loaded. Selective data profiles add saved data under unused names instead. Conflicting unsaved changes are kept in recovery profiles. Snapshots require compatible runtime versions and are never silently reset.

### Extension tools and MCP

Installed Pi tools and enabled MCP servers are available inside Code and all three notebook modes. Configure MCP servers through Pi. Existing permissions, tool restrictions and disabled servers still apply.

`exec` and `wait` wait for their active Pi tool calls to return before yielding, even when the cell's yield timeout has elapsed.

If a server is still connecting, the agent may need to retry its call. Use **Ctrl+O** to expand or collapse tool details, or click individual notices in fullscreen mode.

### Custom commands

Command-backed tools use TOML definitions in either location:

```text
~/.pi/agent/codex-conversion-custom-tools/
<project>/.pi/codex-conversion-custom-tools/
```

See the [working examples](./examples/custom-tools/) and [definition contract](./src/tools/code-mode/CUSTOM-TOOLS.md). For on-demand skill discovery, use [Better Skills Tool](../pi-better-skills-tool).

</details>

<a name="voice-dictation-and-remote-access"></a>

<details>
<summary><strong>Voice, dictation and remote access</strong></summary>

Choose **Voice model** in `/codex voice` or the browser interface. Voice runs independently of the active text model.

| Voice model | Credential |
| --- | --- |
| `codex-live-1.1`, the default | Pi's legacy `openai-codex` login |
| `realtime-2.1` | An OpenAI API key configured in Pi |
| `realtime-2.1-mini` | An OpenAI API key configured in Pi |

Codex Live and dictation use `/login openai-codex`. Selecting a Realtime voice model does not change dictation's login. For Realtime, enter the exact, case-sensitive Pi provider name in **API provider** in terminal or LAN voice settings. The default is `openai`. GipPity uses that provider's API key, headers and compatible Realtime endpoint without storing or displaying the key. Configure the provider's Realtime-compatible endpoint in Pi. Missing keys, OAuth credentials and invalid endpoints are rejected without falling back to another account. Changes apply on the next call. Realtime API calls are billed separately through the selected provider. Sign in with ChatGPT does not provide this API access or replace the legacy Codex login.

Realtime models use `send_task` to send Pi a self-contained task with relevant voice-discussion decisions and constraints. Busy Pi sessions receive it as steering, with existing tools and confirmations preserved. Realtime models can also use developer-registered voice tools. For optional search, load `@howaboua/pi-codex-web-run`, configure its access and enable **Realtime web search**. Search uses Web Run's configured provider and credentials.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+Space` | Toggle realtime voice |
| `Ctrl+Alt+M` | Mute or unmute |
| `Ctrl+Alt+D` | Push-to-dictate. Toggle behaviour is available in the Voice tab |
| `Ctrl+Alt+G` | Toggle the remote voice server |

Audio follows system defaults. Select devices under Voice if needed. Dictation puts an editable transcript in Pi's input.

Choose primary and alternate voices in the Voice tab or browser interface. Codex Live and Realtime keep separate voice choices, defaulting to Cove and Ember for Codex Live, Marin and Cedar for Realtime. Model and voice changes apply to the next call without replacing the current call. With Shepherdr, transferring voice to another session alternates the voice and gives an arrival greeting. **Refresh voice context** summarises and restarts voice after rollover or compaction.

Customise the voice prompt at `~/.pi/agent/REALTIME-SYSTEM-PROMPT.md`. Trusted projects can append `.pi/REALTIME-SYSTEM-PROMPT.md`. Your custom prompts are not rewritten automatically.

### Use voice from another device

**The remote server has no authentication. Keep it on a trusted network.**

Run `/codex voice server`, open its HTTPS address on your phone or another computer, and accept the local certificate. The browser provides voice, mute, editable dictation, typed prompts and Pi activity. Moving between devices does not restart the host's voice call.

Use `/codex voice stop` to stop voice. The remote server stops when its owning Pi session changes.

</details>

<a name="models-and-providers"></a>

<details>
<summary><strong>Models and providers</strong></summary>

PCC supports GPT-6 Astra, Sol and Luna, plus GPT-6.1 Sol and Terra, with Responses Lite and live reasoning adjustments on Codex transport. Available context sizes and reasoning levels depend on the selected model. Cost estimates use [published API rates](https://developers.openai.com/api/docs/pricing).

Default scope covers Codex-like GPT routes and Responses providers listed under **Additional providers**. Switching to an unrelated model restores Pi's ordinary tools.

Codex Live voice, dictation, usage and image descriptions can use the Codex login while another provider's model is active. Realtime voice models use the API provider selected in voice settings instead. The separate web and image-generation extensions also use their configured access independently.

</details>

<a name="troubleshooting"></a>

<details>
<summary><strong>Troubleshooting</strong></summary>

- **No voice device:** check the input and output devices under Voice, then restart the call.
- **Browser microphone blocked:** use the HTTPS address and accept its certificate. Browsers block microphones on plain LAN HTTP.
- **Runtime download failed:** check npm, registry or proxy access, then retry. Downloaded runtimes are cached.
- **TS cannot start:** check its platform requirements above and that npm installs optional dependencies.
- **Bundled helper cannot run:** report the platform and error. Custom builds can be selected with `tools.customRustBinariesDir`, followed by `/reload`. Do not replace system glibc.
- **Configured provider fails:** the endpoint must support the selected API and features, including Responses Lite or native compaction when enabled.

See the [changelog](./CHANGELOG.md) or [report an issue](https://github.com/IgorWarzocha/howaboua-pi-stuff/issues).

</details>

<a name="extension-apis"></a>

<details>
<summary><strong>Building an integration</strong></summary>

Normal Pi tools work with PCC without additional registration. For custom tool behaviour, shared agent context, developer messages or voice announcements, use the [extension API guide](../../docs/extension-apis.md) and [Code Mode example](./examples/code-mode-extension).

To expose a tool directly to Realtime voice models, use `registerGippityVoiceTool` from `@howaboua/pi-codex-conversion/realtime-voice` during extension loading. Calls snapshot the registered tools at startup. Ordinary Pi tools are not automatically exposed to the voice model. Standalone GipPity exports the same API from `@howaboua/pi-gippity-control`.

</details>

## License

MIT. Bundled and vendored third-party components retain their own licences and notices.
