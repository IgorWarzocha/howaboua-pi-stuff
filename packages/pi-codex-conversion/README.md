# pi-codex-conversion

If you're expecting details about the code, you've come to the wrong place. Clone it and ask your Clanka.

Pi already runs GPT models. This extension gives them Codex-shaped tools and prompt handling, then adds voice, compaction and OpenAI controls without turning the provider request into a schema landfill.

For the argument and token numbers, read [How I gave Pi 17 tools without loading 17 schemas](https://howaboua.dev/writing/how-i-gave-pi-17-tools-without-loading-17-schemas/). This README is for using the thing.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

Requires Pi 0.87.0 or newer and Node.js 22.19 or newer. Native helpers for macOS, Linux and Windows are bundled for x64 and arm64.

Open `/codex` after installation. Codex-like GPT models use the structured adapter by default.

**My recommended setup:** select **Notebook** under **General**, enable **Heavy system prompt overwrite**, and choose **Codex V2** compaction under **Context**. These are opt-in, but they're what I'm daily-driving and fine-tuning towards.

## What you get

- Codex-shaped `exec_command`, `write_stdin`, `apply_patch` and `view_image` tools
- Code and Notebook modes that compose the active toolset behind `exec`
- foreground, background and interactive shell sessions with resumable output
- image descriptions for blind models
- realtime voice, push-to-dictate and the GipPity LAN remote mini WebUI
- OpenAI verbosity, fast mode, cached transport, usage, reset credits and context management
- compact Pi-native rendering, status and background-shell controls

Pi keeps its sessions, project context, skills and UI. The model gets the dialect it already knows.

Install [`pi-codex-web-run`](../pi-codex-web-run) or [`pi-codex-imagegen`](../pi-codex-imagegen) for web search or image generation. Both compose into Code and Notebook Mode.

**GipPity has no authentication. Keep its remote server on a trusted network.**

## Reference

<a name="modes"></a>

<details>
<summary><strong>Modes</strong></summary>

| Mode | Behaviour |
| --- | --- |
| **Structured adapter** | Replaces Pi's file and shell tools with the Codex-shaped set. Default for Codex-like GPT models and configured providers. |
| **Code Mode** | Exposes `exec` and `wait`. Shell, patch, image and extension tools compose inside `exec`. |
| **Extra tools only** | Adds selected `apply_patch` or `view_image` tools without replacing the model's normal setup. |
| **Voice only** | Retains voice and dictation without changing the model's prompt, tools, requests, compaction or adapter widgets. |

Structured mode reads files through the shell and edits with `apply_patch`. There are no separate text `read`, `edit` or `write` tools.

Provider scope can stay on **Codex and configured**, expand to **all providers**, or use **extra tools only**.

Change tool loadouts between runs. Mid-run changes update Pi's native schemas but leave prepared Code and Notebook instructions unchanged until the next prepared turn.

</details>

<a name="settings"></a>

<details>
<summary><strong>Settings</strong></summary>

`/codex` saves changes immediately. During a run, they take effect after it settles, including retries and queued continuations. Voice stop, mute and server controls remain immediate.

| Tab | Covers |
| --- | --- |
| General | Settings scope, execution and extension modes, providers, heavy prompt overwrite, time reminders |
| Context | Continuity, notes storage, subagent sharing, compaction, V2 retention |
| Tools | Auto reasoning (GPT-6), image descriptions, standalone tools |
| OpenAI | Fast mode, verbosity, transport, cache diagnostics, Responses Lite |
| Display | Statusline, tool rendering, Code Mode detail, background shells |
| Voice | LAN server, realtime behaviour, summarisation, dictation, shortcuts, prompt paths |
| Usage | Spend by model and reset window, Codex limits, banked reset credits |
| About | GitHub, changelog, Discord, issues |

Open tabs directly with `/codex tools`, `/codex openai`, `/codex display`, `/codex voice`, `/codex usage` or `/codex about`.

### Usage tracking

`/codex usage` shows recorded API-equivalent spend, per-model tokens and estimated quota shares. Spend-rate comparisons use the previous reset window and previous calendar month. `/codex usage analyse` asks your agent to inspect longer-term trends and reasoning levels through a bundled read-only Node script.

Tracking matches the `openai-codex-responses` API, including renamed providers. The standard setup is `openai-codex` on ChatGPT's subscription endpoint. Renamed providers and custom endpoints show an accuracy warning; the warning also remains on totals containing their recorded usage. Usage and reset requests follow the configured endpoint and headers. Proxies must expose the Codex subscription usage API and account-bearing authentication; unsupported endpoints report an error. Aggregator routing and billing are not reconciled.

On first viewing Usage, a background scan imports recorded session costs for the current window and an approximate previous week. Earlier manual reset times cannot be recovered; analysis reports retain the window provenance. Session files lack reliable account identity: local history attaches once to the first viewed account. Missing or unsaved calls cannot be recovered.

Totals persist in `codex-usage.json` in Pi's agent directory, with no conversation content. Later views read running aggregates without rescanning sessions. New tracking is account-separated and includes local Codex responses, native compaction and generated cache keepalive. Other apps, devices and separately implemented tool requests are not included.

Opening or refreshing Usage records the weekly allowance and reset prediction. A changed prediction can split the provisional window; completed windows keep their recorded totals and quota estimates. Partial windows, missing prices and gaps remain visible. Quota shares are cost-weighted estimates because the account allowance can include activity outside Pi. These dollar values are API equivalents, not subscription charges.

### Configuration scope

The first setting chooses **Global** or **This project**:

- **Global:** `~/.pi/agent/pi-codex-conversion.json`.
- **This project:** creates a snapshot at `.pi/pi-codex-conversion.json`. Every tab and **Edit config** targets it. Only trusted folders are read.
- Switching back to Global removes project overrides. Without a project file, all settings inherit globally.
- GPT-5.6 Luna cache keepalive remains global. GPT-5.6 Sol and Terra keepalive follows the project.

`PI_CODEX_FAST=1` or `PI_CODEX_FAST=0` overrides Fast Mode for one Pi process. Run `/reload` after editing config files by hand.

`tools.customRustBinariesDir` overrides bundled helpers by filename, including `exec_bridge`, `apply_patch`, `view_image` and `pi-codex-voice`. Build on the target machine, collect the binaries in one directory, set its path, then `/reload`.

### Optional controls

- **Heavy system prompt overwrite:** removes roughly 40% of Pi's known default scaffold while preserving other extensions' additions. Off by default.
- **Current time reminders:** choose 30 or 60 minutes under **General**. Active Responses adapters receive a persisted UTC developer message on the first inference in each context and when the interval has elapsed. No timer, extra turn or system-prompt change. Off by default.
- **Auto reasoning (GPT-6):** lets Astra, Sol and Luna adjust effort through `change_reasoning` on Codex transport. Offers low, medium and high, never below your starting level, and restores that level after the run settles, including retries and compaction. Enable `tools.autoReasoning` under **Tools**. Off by default.

On these GPT-6 models, auto reasoning and **Shift+Tab** use native configuration updates that preserve the request prefix and continuation eligibility. Cache hits still depend on the server. Updates survive resume and native compaction. Server-side automatic truncation and compaction are incompatible, but explicit Responses compaction V2 is supported. Other models retain Pi's usual reasoning selector.

### Luna Reserve

After ordinary Codex quota runs out, eligible accounts may receive a limited **Luna Reserve** allowance, shown as `gpt-reserve` in backend usage. The extension switches only with backend authorization, then asks you to send `continue`. It never retries for you or redeems a reset credit.

Your original model and reasoning return on the next input after the backend confirms ordinary quota has recovered. Choosing another model cancels that automatic return for the branch. Reserve is not in the ordinary model picker.

</details>

<a name="context-management"></a>

<details>
<summary><strong>Context management</strong></summary>

Choose under `/codex context`:

| Setting | Options | Applies when |
| --- | --- | --- |
| **Continuity strategy** | Compaction · Notes and history · Notes + compaction | Always |
| **History and notes storage** | Local · Tree · Remote | Using notes |
| **Share subagent context** | Off (default) · On | Using notes |
| **Compaction method** | Pi summary · Codex V2 · Both | Using compaction |
| **Preserved user messages (V2 only)** | 16k · 32k · 64k | Using Codex V2 or Both |

Defaults are **Compaction**, **Pi summary** and **64k** retention, with **Local** remembered for notes storage. Hidden controls retain their saved values.

- **Compaction:** Pi's manual and automatic compaction, without notes or rollover tools.
- **Notes and history:** the model saves notes and retrieves history. Explicit new windows start without a conversation summary.
- **Notes + compaction:** new windows carry a compaction checkpoint alongside notes.

**Notes-based strategies are experimental.** Purple markers identify windows. `new_context` preserves the shell, Notebook runtime, workspace and full Pi JSONL. Changing strategy preserves the current conversation and usable checkpoints. Only an explicit notes-only rollover cuts the previous conversation.

Resume notes-based sessions with the same storage. Changing storage neither copies notes nor starts a window or disables compaction. Switching to **Compaction** removes recovery tools without turning notes into a summary.

### Storage and compaction

- **Local:** reads prior windows and stores model-invisible note updates in Pi's JSONL.
- **Tree:** archives windows as Pi side branches. Branch summaries stay visible in the transcript, outside model context. History search prioritizes summaries but can retrieve every raw entry.
- **Remote:** uses Codex's encrypted history and notes service. Requires `openai-codex-responses` and fails without switching storage. Other transports ignore it.

Local and Tree require an active Responses adapter. Other provider APIs do not expose notes-based context management.

**Pi summary** is readable. **Codex V2** is an encrypted checkpoint. **Both** adds a readable summary on a separate request lane, at extra summarization cost. Codex uses the checkpoint while other providers can use the summary. Both supports every storage backend and either compaction-based strategy. V2 retention budgets recent user messages kept verbatim, not total context.

V2 and Both require Codex or an explicitly configured compatible passthrough. Other routes use Pi summary without erasing the saved method. Selecting Pi summary preserves an existing V2 checkpoint until the next successful compaction converts it. **Choose Both before the checkpoint you need across providers, or convert to Pi summary before switching.** Tree checkpoints remain usable by reference after changing storage.

Old configurations migrate on read without rewriting the file. Hybrid becomes **Notes + compaction** with **Codex V2**. V2 with Parallel Pi summary becomes **Compaction** with **Both**. Saving removes the old switches.

### Rollover and recovery

With notes enabled, choosing a summary in Pi's tree navigator saves a handoff note for the destination, even before the first window marker. Local and Tree preserve existing destination notes. Remote note contents remain encrypted and cannot be independently verified. Interrupted or failed handoffs cancel the jump. **No summary** remains a plain jump.

The model receives history, notes, rollover and remaining-context tools. Checkpoint reminders arrive at **85% used** and **90%**, unless the current run has already saved notes. They may request a checkpoint after a final reply but never force rollover, interrupt tools or validate notes. Percentages use the model's full configured window.

With **Notes and history**, `/compact` reuses notes from the last completed run and opens a window without starting a new turn. New input or another run makes those notes stale. Without fresh notes, or with checkpoint instructions, it asks the agent to save state, then opens the window after that run settles. A failed or missing note leaves the current window in place. With **Notes + compaction**, `/compact` and `new_context` compact before rollover.

Automatic overflow recovery compacts in the current window. Notes-only sessions use Pi summary for this emergency recovery. Other strategies use the selected method. Pi's automatic compaction must be enabled.

### Shared agent context

**Share subagent context** shares notes and history with newly spawned agents through a compatible subagent extension. It is off by default. Children get unique agent paths and native Pi thread IDs under the parent's session identity, not a shared transcript.

Identity survives rollover and resume. Forks start independent families. Turning sharing off affects future spawns, not existing children. Existing sessions are never rebound.

Remote sharing requires the same Codex account and Remote storage throughout. Local and Tree retain notes in their owning sessions and rely on the integrating extension for transport. Remote failures never switch storage. See [Extension APIs](#extension-apis) below for integration.

</details>

<a name="cache-diagnostics"></a>

<details>
<summary><strong>Cache diagnostics</strong></summary>

Set **Cache diagnostics** to **Status** or **Status + log** under `/codex openai`. Off by default.

Pi's footer shows cache percentage. The extension-status row explains transport and continuation:

```text
Codex adapter V: low • notebook mode Codex Cache • HIT • WS delta
```

| Status after `Codex Cache` | Meaning |
| --- | --- |
| `waiting` | No Codex request observed yet |
| `prewarm ready • WS new` | New socket prepared. `WS reused` means an existing socket |
| `HIT • WS delta` | Cached input reported, only continuation input sent |
| `HIT • WS full (body mismatch)` | Full request required, but prompt cache still hit |
| `MISS • WS full (input prefix mismatch)` | History diverged and no cached input was reported |
| `WS retry 2` | Retrying after the first WebSocket failure |
| `WS → SSE` | WebSocket recovery ended, switched to SSE |
| `compaction • HIT • WS delta` | Native compaction reused continuation |
| `WS failed: authentication • invalid_token • 401` | Safe error metadata only |

A miss stays visible for three seconds before the row jumps to the latest state. **WebSocket continuation and prompt caching are separate.** A full request can still hit the cache.

**Status + log** adds `• log` and writes to `~/.pi/agent/pi-codex-logs/<session-derived-name>.log`. Logs include transport, continuation, token counts, retries and allowlisted errors. They exclude prompts, messages, tool arguments, images, credentials, provider payloads and response IDs.

Pi's generic cache warmer is disabled on Codex and Responses Lite because they cannot honor its one-token output cap and warming would disturb continuation. Native Codex uses separately configured, isolated keepalive. Other routes retain Pi's warmer.

</details>

<a name="code-mode-and-custom-tools"></a>

<details>
<summary><strong>Code Mode and custom tools</strong></summary>

Select **Code** or **Notebook** under `/codex` → **General**. This applies wherever the adapter is active, including **all providers** scope. Providers retain their normal transport. Compatible Codex models use Responses Lite automatically. Configured OpenAI Responses proxies can opt in through **Proxy Responses Lite**.

The model composes tools in a JavaScript cell:

```js
const status = await tools.exec_command({ cmd: "git status --short" });
text(status);
```

**Notebook** adds persistent JavaScript and TypeScript bindings in Deno. Its top-level `notebook` tool manages status, checkpoints, restarts, resets and profiles. The first turn receives status and retained bindings automatically.

### Notebook hooks

Pinned functions can react without another model call. Use the top-level `notebook` tool with `{ action: "pin", names: ["onToolResult"], hook: "tool_result" }`, not a call inside `exec`.

The handler receives `{ type: "tool_result", toolName, input, status, result?, error? }` for subsequent `tools.*` calls. Filter by `toolName`. Input is captured before execution. Status is `"success"` for a returned result or `"error"` for a throw.

Handlers get independent snapshots and run in name order, awaited before the caller continues. Independent calls may overlap. Handlers cannot replace outcomes, and their own tool calls do not trigger more handlers. Failures are reported without changing the original result.

Use `hook: "startup"` for initialization after project, session and profile restoration, once per fresh kernel. It receives `{ type: "startup" }`. Pinning does not invoke it. Import dependencies inside the function and recreate handles through `globalThis`. Pi tools cannot run during startup. Startup failures block execution, but unpin remains available.

Ordinary pins are passive. Omit `hook` to preserve its setting, use `hook: false` to remove it, or unpin. Hooks restore with the kernel. Other sessions' changes apply only on restoration. Hooks observe Notebook tool calls only. External side effects are not rolled back.

### TOML custom tools

Custom tools pair a top-level TOML definition with a command accepting one string. Put them in:

```text
~/.pi/agent/codex-conversion-custom-tools/
<project>/.pi/codex-conversion-custom-tools/
```

Promoted tools add one usage line. Deferred tools add no startup text and are discoverable through `ALL_TOOLS`. Neither adds a provider schema. Tell your Clanka when you want a deferred tool used, or it might never realise it's there.

See the disabled [working examples](./examples/custom-tools/) and [definition contract](./src/tools/code-mode/CUSTOM-TOOLS.md). For progressive skills, prefer [`pi-better-skills-tool`](../pi-better-skills-tool). The legacy `skills` example requires `--no-skills`.

</details>

<a name="voice-dictation-and-gippity"></a>

<details>
<summary><strong>Voice, dictation and GipPity</strong></summary>

Voice uses your Pi OpenAI Codex login independently of the active model. The spoken model handles conversation and routes work. Pi keeps the tools, files and actual job.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+Space` | Toggle realtime voice |
| `Ctrl+Alt+M` | Mute or unmute without ending the call |
| `Ctrl+Alt+D` | Push-to-dictate. Toggle behaviour is available in the Voice tab |
| `Ctrl+Alt+G` | Toggle the GipPity LAN server |

Audio follows system defaults. Use `voice.inputDevice` or `voice.outputDevice` to pin an endpoint. Dictation puts an editable transcript in Pi's input.

Fresh installs use Cove for voice and Luna with high reasoning for context summarisation. Calls resume after transport drops. **Refresh voice context** summarizes and restarts voice at context rollovers or compaction, preserving mute and LAN ownership. If summarisation fails, the old call remains untouched.

The voice prompt lives at `~/.pi/agent/REALTIME-SYSTEM-PROMPT.md`. Trusted projects can append `.pi/REALTIME-SYSTEM-PROMPT.md`. Keep project instructions in AGENTS.md. Outdated prompts trigger a pointer to the bundled changelog, never an automatic rewrite of your customizations. Template and changelog paths appear in the Voice tab.

```text
/codex voice realtime
/codex voice mute
/codex voice dictation
/codex voice stop
/codex voice server
```

`/codex voice server` starts GipPity over HTTPS and prints its addresses. Open one on your phone or another machine and accept the local certificate. Handy for a devbox without a mic, or talking to Pi remotely over Tailscale.

GipPity offers voice, mute, editable dictation, typed prompts, Pi activity and settled replies. Moving devices does not restart the host's voice call. It follows Pi's theme and can be saved as a phone app.

The server stops when its owning Pi session changes. It has no authentication. Use a trusted network.

</details>

<a name="models-and-providers"></a>

<details>
<summary><strong>Models and providers</strong></summary>

GPT-6 Astra, Sol and Luna support Responses Lite and native reasoning updates. All default to 272K context in this provider. Cost estimates use [published Standard API rates](https://developers.openai.com/api/docs/pricing), including cache reads, writes and the long-context tier above 272K input tokens.

Default scope covers Codex-like GPT routes and Responses providers listed under **Additional providers**. Switching to an unrelated model restores Pi's ordinary tools.

Voice, usage and image descriptions can use the Codex login while another provider's model is active. Image descriptions use GPT-6 Luna. The separate web and image-generation extensions also use that login independently.

Native compaction requires OpenAI Codex or an explicitly configured compatible passthrough. Unsupported states fail visibly or use Pi compaction. Enable **Both** before creating a checkpoint you need across providers, or convert it to Pi summary before switching.

</details>

<a name="migrating-from-lite"></a>

<details>
<summary><strong>Migrating from Lite</strong></summary>

Lite has graduated into this package and receives no updates after its final release. Remove it first because both packages share commands and configuration:

```bash
pi remove npm:@howaboua/pi-codex-conversion-lite
pi install npm:@howaboua/pi-codex-conversion
```

Your existing `~/.pi/agent/pi-codex-conversion.json` still loads. Web search and image generation are now separate:

```bash
pi install npm:@howaboua/pi-codex-web-run
pi install npm:@howaboua/pi-codex-imagegen
```

The old canonical package's PATH mode and binaries are gone. Old settings normalize to the structured adapter. Use structured tools or Code Mode custom commands instead.

</details>

<a name="troubleshooting"></a>

<details>
<summary><strong>Troubleshooting</strong></summary>

- **No voice device:** let the setup turn inspect endpoints, save the chosen IDs, then restart voice.
- **GipPity microphone blocked:** use Pi's HTTPS URL and accept its certificate. Browsers block microphones on plain LAN HTTP.
- **Code Mode cannot start:** its pinned host is prepared lazily and honors proxy environment variables. Pi reports setup failures.
- **Bundled helper cannot run:** build it on the target machine, set `tools.customRustBinariesDir`, then `/reload`. Do not replace system glibc. Web search and image generation need no native helper.
- **Configured provider fails:** it must implement its declared API. Proxy Responses Lite and native compaction require their respective backend contracts.

For anything stranger, clone the repository and ask your Clanka:

```bash
git clone https://github.com/IgorWarzocha/howaboua-pi-stuff.git
cd howaboua-pi-stuff
bun install
pi --no-extensions --no-skills -e ./packages/pi-codex-conversion
```

See [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md), [`CHANGELOG.md`](./CHANGELOG.md) and [GitHub issues](https://github.com/IgorWarzocha/howaboua-pi-stuff/issues).

</details>

<a name="extension-apis"></a>

<details>
<summary><strong>Extension APIs</strong></summary>

### Pi extension API

Register a Pi tool normally, then adapt it for Code and Notebook Mode:

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

See the [complete example](./examples/code-mode-extension). Declare `@howaboua/pi-codex-conversion` 3.0.24 or newer as a peer dependency. Import lazily if your extension must work without Pi Codex.

Adapted tools retain Pi context, UI, schema, progress and rendering. JavaScript receives model-usable content. Code Mode owns nested-call preflight and translates non-JavaScript tool names consistently in prompts and `ALL_TOOLS`.

| Option | Purpose |
| --- | --- |
| `usage` | Callable contract. Include arguments or a help entry point. Only `promptGuidelines` accompany it, not native descriptions, snippets or schemas |
| `toolName` | Non-default Responses namespace |
| `resultValue` | Structured JavaScript result instead of ordinary model-visible content |
| `blocking` | `true` or an input predicate to hold the turn. Otherwise long calls can yield to `wait` |
| `deferLoading` | Omit startup usage. Full metadata remains discoverable through `ALL_TOOLS` |
| `kind: "freeform"` | Use `prepareInput` to map a string into normal Pi parameters |
| `isActive` | Gate a session-specific tool. Keep returning its definition and call `registration.refresh()` when activation changes |

Activation is also sampled at normal session and input boundaries. Prompt, registry and outer-tool filtering then stay fixed through the run.

Working integrations include [`pi-ask`](../pi-ask) for blocking UI, [`pi-better-skills-tool`](../pi-better-skills-tool) and [`pi-browser`](../pi-browser) for freeform input, [`pi-codex-web-run`](../pi-codex-web-run) and [`pi-codex-imagegen`](../pi-codex-imagegen) for namespaced structured results, and [`pi-shepherdr`](../pi-shepherdr) for activation and per-call blocking.

### Developer messages

```ts
import { sendCodexDeveloperMessage } from "@howaboua/pi-codex-conversion/developer-messages";

sendCodexDeveloperMessage(pi, "Re-evaluate the plan before editing.", {
	deliverAs: "steer",
	triggerTurn: false,
});
```

Messages persist in Pi's purple block and reach compatible Responses models as `developer`. Display metadata stays model-invisible. `deliverAs` accepts `steer`, `followUp` and `nextTurn`. `triggerTurn` can start an idle turn for the first two.

Sending without a compatible adapter throws, never falling back to a user message. Optional integrations can use `trySendCodexDeveloperMessage`, which returns `false` when the broker or adapter is unavailable. Delivery failures still throw.

Use `trySendCodexDeveloperCustomMessage(pi, { customType, content, display, details }, options)` to retain your renderer and restoration fields. Content must be nonempty text. Details must be a plain object or omitted. A copied details object gains the reserved `@howaboua/pi-codex-conversion/developer-message` key.

Lazy integrations should check that this export exists. Fall back to an ordinary custom message only on absence or `false`, never after a delivery error. Older brokers return `false`.

Persisted messages use ordinary Pi conversion on incompatible models and regain the developer role on compatible Responses models. Custom messages retain their renderer and restoration fields.

### Nested tool hooks

Pi's `tool_call` and `tool_result` events see outer `exec` and `wait`, not nested calls. Subscribe separately:

```ts
import {
  registerCodeModeToolPreflight,
  registerCodeModeToolCompletion,
} from "@howaboua/pi-codex-conversion/code-mode-hooks";

const guard = registerCodeModeToolPreflight(pi, async (call) => {
  // Return { block: true, reason } to reject a nested call before execution.
});
const observer = registerCodeModeToolCompletion(pi, async (call) => {
  // Persist call.toolName, call.toolCallId, call.input, call.status and call.result.
});
```

Registrations expose `available` and `dispose()`, handle either load order and dispose on shutdown. The older `code-mode-preflight` import remains supported. Older preflight-only brokers lack completion.

Completion runs once when a recognized nested call settles. `input` precedes preparation. `result` is the full captured Pi result, including details and images, or the returned value when no Pi result was captured. Errors include `status: "error"`, an `error` string and `phase: "preflight" | "execution"`. Without a captured result, `result` is undefined. Failed calls may have side effects. Cancellation is visible through `signal.aborted`.

Subscribers receive independent structured clones and run in registration order, awaited even after cancellation. Settle promptly. Subscriber failures and uncloneable values go to stderr without changing the outcome. Preflight can block. Completion only observes and does not expand agent-visible output.

### Context sharing

The optional `context-sharing` API does not require Shepherdr:

```ts
import { connectCodexContextSharing } from "@howaboua/pi-codex-conversion/context-sharing";

const connection = connectCodexContextSharing(pi);
// In a prepared parent session:
const service = connection.service;
if (!service?.canCreateChild(ctx)) return; // Otherwise launch an independent child.
const binding = await service.createChild(ctx, { name: "worker" });
// Launch Pi normally and deliver binding through your integration.
// In the fresh, idle child, before sending its first task:
await childService.bind(childCtx, binding);
```

Pi owns session creation and persistence. `createChild` requires parental opt-in. `bind` accepts that explicit binding regardless of the child's setting for future spawns. It validates storage and account, rejecting used sessions or different existing bindings. `describe(ctx)` reports identity and storage. `verify(ctx)` checks Remote account compatibility.

For Local and Tree, register a router in each participant with `registerRouter`, pass its opaque `routing` descriptor to `createChild`, and route incoming requests through the target's `service.execute(ctx, request, signal)`. Validate family membership, preserve errors and never write directly to another session file. Dispose the connection on shutdown.

### Realtime announcements

Ask an active voice session to speak:

```ts
import { reportRealtimeVoicePrompt } from "@howaboua/pi-codex-conversion/realtime-voice";

const announcement = {
	id: "my-extension:finished",
	prompt: "Briefly tell the user that the task finished.",
};
reportRealtimeVoicePrompt(pi, { ...announcement, active: true });
reportRealtimeVoicePrompt(pi, { ...announcement, active: false });
```

For ongoing states, send `active: true` at the start and `active: false` at the end. For one-off announcements, send both immediately.

</details>

<a name="develop-against-upstream-pi"></a>

<details>
<summary><strong>Develop against upstream Pi</strong></summary>

Normal development uses published Pi packages from `bun install`. To test upstream changes, build a Pi checkout and link it explicitly:

```bash
bun run pi:link-checkout -- /absolute/path/to/pi
```

This validates the built transcript exports and CLI, then replaces only this repository's Pi dependency links. Run `bun install` to restore manifest-resolved packages.

Build the extension and launch the checkout's CLI:

```bash
bun run --cwd packages/pi-codex-conversion build
PI_CHECKOUT="$(cd /absolute/path/to/pi && pwd -P)"
EXTENSION="$(pwd -P)/packages/pi-codex-conversion"
node "$PI_CHECKOUT/packages/coding-agent/dist/cli.js" \
  --no-extensions --no-skills -e "$EXTENSION"
```

</details>

## License

MIT. Bundled and vendored third-party components retain their own licences and notices.
