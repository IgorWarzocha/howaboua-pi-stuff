# pi-codex-conversion

If you're expecting details about the code, you've come to the wrong place. Clone it and ask your Clanka.

Pi already runs GPT models. This extension gives them Codex-shaped tools and prompt handling, then adds voice, compaction and OpenAI controls without turning the provider request into a schema landfill.

For the argument and token numbers, read [How I gave Pi 17 tools without loading 17 schemas](https://howaboua.dev/writing/how-i-gave-pi-17-tools-without-loading-17-schemas/). This README is for using the thing.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

Requires Pi 1.4.0 or newer and Node.js 22.19 or newer. Native helpers for macOS, Linux and Windows are bundled for x64 and arm64.

Open `/codex` after installation. Codex-like GPT models use the structured adapter by default.

**My recommended setup:** select **Notebook** under **General**, enable **Heavy system prompt overwrite**, and choose **Codex V2** compaction under **Context**. These are opt-in, but they're what I'm daily-driving and fine-tuning towards.

## What you get

- Codex-shaped `exec_command`, `write_stdin`, `apply_patch` and `view_image` tools
- Code, Notebook, TS and JS Notebook modes that compose the active toolset behind `exec`
- foreground, background and interactive shell sessions with resumable output
- image descriptions for blind models
- realtime voice, push-to-dictate and the GipPity LAN remote mini WebUI
- OpenAI verbosity, fast mode, cached transport, usage, reset credits and context management
- compact Pi-native rendering, status and background-shell controls

Pi keeps its sessions, project context, skills and UI. The model gets the dialect it already knows.

Install [`pi-codex-web-run`](../pi-codex-web-run) or [`pi-codex-imagegen`](../pi-codex-imagegen) for web search or image generation. Both compose into Code, Notebook, TS and JS Notebook modes.

**GipPity has no authentication. Keep its remote server on a trusted network.**

## Reference

<a name="modes"></a>

<details>
<summary><strong>Modes</strong></summary>

| Mode | Behaviour |
| --- | --- |
| **Structured adapter** | Replaces Pi's file and shell tools with the Codex-shaped set. Default for Codex-like GPT models and configured providers. |
| **Code Mode** | Exposes `exec` and `wait`. Shell, patch, image and extension tools compose inside `exec`. |
| **Notebook** | Adds persistent Deno bindings and `notebook` state controls. |
| **JS Notebook** | Runs persistent JavaScript in QuickJS/WASM with full VM checkpoints. Tools provide host access. |
| **TS** | Type-checks TypeScript cells and merges concurrent changes into portable retained state. Uses Node. |
| **Extra tools only** | Adds selected `apply_patch` or `view_image` tools without replacing the model's normal setup. |
| **Voice only** | Retains voice and dictation without changing the model's prompt, tools, requests, compaction or adapter widgets. |

Structured mode reads files through the shell and edits with `apply_patch`. There are no separate text `read`, `edit` or `write` tools.

Provider scope can stay on **Codex and configured**, expand to **all providers**, or use **extra tools only**.

Custom-tool contract changes and removals, including promoted tools, are announced before the next model request without rebuilding standing execution-mode instructions. `ALL_TOOLS` contains complete callable contracts.

</details>

<a name="settings"></a>

<details>
<summary><strong>Settings</strong></summary>

`/codex` saves changes immediately. During a run, they take effect after it settles, including retries and queued continuations. Voice stop, mute and server controls remain immediate.

| Tab | Covers |
| --- | --- |
| General | Settings scope, execution and extension modes, providers, heavy prompt overwrite, time reminders |
| Context | Compaction method and V2 retention |
| Tools | Auto reasoning (GPT-6), image descriptions, standalone tools |
| OpenAI | Per-family Fast and Ultrafast modes, Daybreak, verbosity, transport, diagnostics, Responses Lite |
| Display | Statusline, tool rendering, Code Mode detail, note save markers, background shells |
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
- Luna cache keepalive remains global. Astra, Sol and Terra keepalive follows the project, across model versions.

Fast Mode has independent settings for Astra, Sol, Terra and Luna, shared across each family's model versions. Choose off, on for priority processing, or Ultrafast. Existing boolean preferences still work. `PI_CODEX_FAST=1`, `0` or `ultrafast` overrides every family for one Pi process. Availability depends on the model and account. Ultrafast API-equivalent estimates use the published rates for GPT-6 Astra and GPT-6.1 Sol, six times Standard. Other models retain base-rate estimates without an unknown Ultrafast premium. These estimates are not subscription quota rates. Run `/reload` after editing config files by hand.

On Codex transport, the Daybreak toggle keeps your selected model and chooses an access program from the connected account's model catalog: Blue first, otherwise Red. When enabled, unconfirmed support stops the request rather than silently using ordinary routing. Turning Daybreak off requests Standard when advertised, otherwise leaves the program unset. The server still checks approval and model access. Existing Daybreak model aliases remain available. See [OpenAI's Daybreak guide](https://developers.openai.com/api/docs/guides/daybreak) for supported combinations.

`tools.customRustBinariesDir` overrides bundled helpers by filename, including `exec_bridge`, `apply_patch`, `view_image` and `pi-codex-voice`. Build on the target machine, collect the binaries in one directory, set its path, then `/reload`.

Code Mode always uses the pinned official OpenAI runtime, downloaded on first use. It does not use local builds or `tools.customRustBinariesDir`.

### Optional controls

- **Heavy system prompt overwrite:** **on** removes roughly 40% of Pi's known default scaffold while preserving other extensions' additions. **GPT (experimental)** builds on that baseline with denser PCC instructions and participating toolkit guidance. Tool arguments and capabilities stay unchanged. Savings depend on execution mode and context. Off by default. Existing boolean configuration still works. Set `prompt.heavySystemPromptOverwrite` to `"gpt"` for GPT mode.
- **Current time reminders:** choose 30 or 60 minutes under **General**. Active Responses adapters receive a persisted UTC developer message on the first inference in each context and when the interval has elapsed. No timer, extra turn or system-prompt change. Off by default.
- **Auto reasoning:** lets GPT-6 Astra, Sol and Luna, plus GPT-6.1 Sol, adjust effort through `change_reasoning` on Codex transport. Offers low, medium, high, xhigh and max, never below your selected level, and restores that level after the run settles, including retries and compaction. Enable `tools.autoReasoning` under **Tools**. Off by default.

On these GPT-6 models, auto reasoning and **Shift+Tab** use native configuration updates that preserve the request prefix and continuation eligibility. Cache hits still depend on the server. Updates survive resume and native compaction. Server-side automatic truncation and compaction are incompatible, but explicit Responses compaction V2 is supported. Other models retain Pi's usual reasoning selector.

### Luna Reserve

After ordinary Codex quota runs out, eligible accounts may receive a limited **Luna Reserve** allowance, shown as `gpt-reserve` in backend usage. The extension switches only with backend authorization, then asks you to send `continue`. It never retries for you or redeems a reset credit.

Your original model and reasoning return on the next input after the backend confirms ordinary quota has recovered. Choosing another model cancels that automatic return for the branch. Reserve is not in the ordinary model picker.

</details>

<a name="context-management"></a>

<details>
<summary><strong>Context management</strong></summary>

Choose the compaction method under `/codex context`:

| Setting | Options |
| --- | --- |
| **Compaction method** | Pi summary · Codex V2 · Both |
| **Preserved user messages (V2 only)** | 16k · 32k · 64k |

Defaults are **Pi summary** and **64k** retention. Pi summary is readable. Codex V2 is an encrypted OpenAI checkpoint. Both adds a readable summary on a separate request lane, at extra summarisation cost. V2 retention budgets recent user messages kept verbatim, not total context.

V2 and Both require Codex or an explicitly configured compatible passthrough. Other routes use Pi summary without erasing the saved method. Selecting Pi summary preserves an existing V2 checkpoint until the next successful compaction converts it. **Choose Both before the checkpoint you need across providers, or convert to Pi summary before switching.** Native response replay remains available on supported routes.

PCC does not supply notes tools, notes settings or window modes. Install optional [Notes Compaction](../pi-notes-compaction/README.md) for notes, history, checkpoint guidance, rollover and shared agent context. Configure those under `/notes`. Notes owns automatic read-only hybrid lookup. New writes stay local; the legacy Remote write mode is retired.

Existing saved notes, window boundaries, Tree archives and compaction checkpoints remain readable. Notes imports applicable legacy PCC preferences when its own settings are absent. Changing ownership does not copy notes or decrypt old remote content.

</details>

<a name="cache-diagnostics"></a>

<details>
<summary><strong>Codex diagnostics</strong></summary>

Set **Codex diagnostics** to **Status** or **Status + log** under `/codex openai`. Off by default. The existing `openai.cacheDiagnostics` configuration key and values are unchanged.

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

**Status + log** adds `• log` and writes to `~/.pi/agent/pi-codex-logs/<session-derived-name>.log`. Logs cover response, prewarm and native compaction requests, cache and continuation decisions, model settings, routing-hint presence, parent-link presence, allowlisted worker classification, token usage, retries, fallback and safe failures. Parent identifiers and routing-header values are not recorded. `previous_response_present` is a boolean, not a response ID.

Logs exclude prompts, messages, tool arguments, images, credentials, provider payloads and response IDs.

On a reused WebSocket, request settings describe the current body but handshake headers are not resent. `request_headers_sent=false` makes that boundary explicit. A routing hint is advisory, not evidence of a routing decision.

Local request IDs correlate retries and fallback without using server IDs. Timings use a monotonic clock. `send_ms`, `first_event_ms`, `first_visible_text_ms` and `completion_ms` are measured from the local transport attempt start, including connection acquisition. First visible text means receipt of the first nonempty text delta, not a screen-paint timestamp. Completion means receipt of a terminal response event. `request_elapsed_ms` spans provider preparation and recovery, not the harness's whole user turn. For reused prewarm readiness without a sent request, only elapsed time is available.

`output_tokens_per_second` is completed provider-reported output tokens divided by the interval from send to completion. It includes reasoning tokens where the provider includes them in output usage. It is not visible-text speed or an inference-only rate. Non-generating prewarm and failed attempts report no throughput. Missing local boundaries are `null`.

Optional backend timing fields retain their original names. Missing fields are `"missing"` and explicit backend nulls remain `null`. Backend delta counts are not token counts, engine counters are not billing usage, and `engine_service_total_ms` is not inference duration.

Pi's generic cache warmer is disabled on Codex and Responses Lite because they cannot honor its one-token output cap and warming would disturb continuation. Native Codex uses separately configured, isolated keepalive. Other routes retain Pi's warmer.

Keepalive is opt-in and sends quota-consuming requests while idle. In `/codex` under OpenAI, Astra, Sol and Terra offer Off or a 25 or 55 minute request interval for this project. Luna offers a global Off or 5, 10 or 15 minute duration, with a separate 2.5 or 4.5 minute request interval. Changing Luna's interval does not enable keepalive or extend its duration. Requests stop when that duration expires, and completed requests can reduce how many fit within it. Existing enabled settings retain their 25 minute or 2.5 minute interval.

These are request intervals, not guaranteed cache lifetimes. Reports suggest around an hour for Astra and Sol and five minutes for Luna 6, but retention can vary. Keepalive intervals are independent of notes-managed idle rollover and task-boundary reminders.

</details>

<a name="code-mode-and-custom-tools"></a>

<details>
<summary><strong>Code Mode and custom tools</strong></summary>

Select **Code**, **Notebook**, **TS** or **JS Notebook** under `/codex` → **General**. This applies wherever the adapter is active, including **all providers** scope. Providers retain their normal transport. Compatible Codex models use Responses Lite automatically. Configured OpenAI Responses proxies can opt in through **Proxy Responses Lite**.

The model composes tools in a JavaScript cell:

```js
const status = await tools.exec_command({ cmd: "git status --short" });
text(status);
```

**Notebook** adds persistent JavaScript and TypeScript bindings in Deno. Call `notebook({})` for state-management guidance, then send JSON action objects in `input`. Explicit `{ input: "help" }` also returns guidance. The first turn receives status and retained bindings automatically.

### JS Notebook

**JS Notebook** retains JavaScript lexical bindings, closures, classes and cycles in a QuickJS/WASM kernel. Run Pi under Node. Cells support top-level `await` but have no Node, imports, network APIs, timers or TypeScript checking. Use `tools` for host operations and await every call.

Normal cells share serial live state. Successful settled cells save a full VM checkpoint. Failed cells can leave mutations, and cancelling a live cell stops the shared kernel. `notebook` restart restores the last checkpoint without undoing external tool effects. Saved snapshots require compatible engine and notebook bridge versions; incompatible snapshots are rejected, not silently reset.

Add `"isolated":true` to the `// @exec` options to run a snapshot clone. Its saved candidate can replace the live state through `notebook` load. Named profiles also replace the entire state and are separate from other execution modes. Call `notebook({})` for status, diagnostics, checkpoint, save, load, list, restart and reset. JS Notebook does not offer per-binding pins, hooks or release controls.

### TS mode

**TS** type-checks TypeScript before execution and retains bindings and type declarations between cells. It uses Node and Web APIs, not Deno. Run Pi under Node on Linux x64, Linux arm64 or an Apple Silicon Mac. TS mode is unavailable on Windows and Intel Macs.

Normal cells execute sequentially in one live kernel. Variables, closures, class instances and module state remain available across cells. Runtime errors can leave earlier mutations in place. Cancelling an executing cell stops the kernel; restart restores its last durable checkpoint, not its live-only values.

Add `"isolated": true` to the `// @exec:` options for concurrent work in a separate process. Isolated cells start from the last portable checkpoint, not the live heap. Their state is saved as a named candidate and never automatically merged into the kernel. Loading a candidate deliberately replaces the kernel, discarding its live-only values and unsaved changes. Tool and file effects are not rolled back in either execution path.

Use `notebook({})` for state controls, project pins, named profiles and startup or tool-result hooks. Durable capture preserves supported data, aliases, cycles, types and self-contained helper recipes. It reports live-only values that cannot be saved. Profiles load by value and refuse colliding bindings. Release and prune rebuild the kernel so names can be reused, clearing live-only values. State changes, save and checkpoint require idle cells. TS storage remains separate from Deno Notebook. TS does not export `.ipynb` history or retain a cell journal for historical diagnostics.

Register snapshot and restore helpers to retain objects that cannot otherwise be saved. For example, this counter keeps private state in a closure:

```ts
function restoreCounter(n: number): { next(): number; current(): number } {
  return { next: () => ++n, current: () => n };
}
function snapshotCounter(counter: { current(): number }): number {
  return counter.current();
}
const counter = restoreCounter(0);
```

After the cell finishes, call `notebook` with `{"input":"{\"action\":\"pin\",\"names\":[\"counter\"],\"checkpoint\":{\"snapshot\":\"snapshotCounter\",\"restore\":\"restoreCounter\"}}"}`. Later captures save its current count. Restart reconstructs the counter and preserves aliases to it, without replaying previous cells. Both helpers may be async. Define classes inside the restore helper or import their constructors, and give factories for private-field classes an explicit structural return type.

Restoration also runs when loading profiles and starting isolated cells. Reconnecting clients can have external effects. Snapshot failures preserve the last good checkpoint. Restore failures block execution and report the names to unpin for recovery. Ordinary unpinning removes registration without destroying the live object. Arbitrary unregistered closures and handles remain live-only.

Imports support Node built-ins, installed packages, local TypeScript files and exact `npm:package@version` specifiers. New npm dependencies require user approval. Installation scripts are disabled. Module instances persist in the live kernel; isolated cells initialise their own copies. Local TypeScript modules support literal imports, but not computed dynamic imports. Tool arguments are checked against their schemas. Nested tool results remain dynamically typed, so ordinary result access needs no extra guards or casts.

### Pi extension and MCP tools

Pi-callable extension tools automatically appear in `tools`, with no extra registration. `ALL_TOOLS` lists active direct tools and tools with `codemode` exposure. Native extension tools with `deferred` exposure appear in the catalogue only while active in Pi, but remain callable by name while inactive. Catalogue changes leave standing tool instructions unchanged. An [explicit integration](#extension-apis) takes precedence for the same Pi tool, including its custom behaviour and activation gate. Hidden and model-only tools are not imported.

Configure MCP servers once in Pi's built-in MCP extension. Its callable tools and resource helpers use the same bridge and remain discoverable in `ALL_TOOLS`. Pi's extension switches, tool restrictions and disabled servers are respected. Pi retains connection management, authentication, permissions and tool hooks; its native `codemode` extension is not required.

`exec` waits for pending MCP connections named in its source before starting the cell. Using `ALL_TOOLS` waits for all enabled servers. Names assembled dynamically or hidden in retained functions may not identify a server. Missing-tool errors identify the MCP namespace when known, otherwise flag ambiguous name prefixes. If that server connects, retry in a new exec cell. Repeated failures may require disabling that server. Calls are never retried automatically and servers are never disabled automatically.

MCP discovery starts from Pi's server summaries. Read, `find` or `filter` the synchronous `ALL_TOOLS` array for complete usage, schemas and server instructions. Each cell's catalogue contains tools connected when that cell starts. Custom and deferred tools use the same catalogue, not another discovery tool.

Notebook status and tool notices follow Pi's theme. Use **Ctrl+O** to expand or collapse them all, or click an individual notice in fullscreen mode.

MCP server tools return their complete result object, including `content`, `structuredContent` and `isError`. Use `image(block)` for image content. Individual MCP calls finish or cancel before the enclosing `exec` or `wait` returns; cells can yield between calls.

### Notebook hooks

Pinned functions can react without another model call. Use the top-level `notebook` tool with `{ input: '{"action":"pin","names":["onToolResult"],"hook":"tool_result"}' }`, not a call inside `exec`.

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

Promoted tools add one standing usage line. Deferred tools appear in the availability inventory, with complete contracts in `ALL_TOOLS`. Neither adds a per-tool provider schema.

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

Choose **Primary voice** and **Alternate voice** in the Voice tab or LAN UI. New calls use the primary voice. With Shepherdr, each voice transfer to another session alternates the voice and gives an arrival greeting. Reconnects and context refreshes keep the current voice. Defaults are Cove and Ember.

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

GPT-6.1 Sol and GPT-6 Astra, Sol and Luna support Responses Lite and native reasoning updates. All default to 272K context in this provider. GPT-6.1 Sol supports reasoning from `low` through `max`, without `off` or `minimal`. Cost estimates use [published Standard API rates](https://developers.openai.com/api/docs/pricing), including cache reads, writes and the long-context tier above 272K input tokens.

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

Normal Pi registration is enough for automatic Code, Notebook, TS and JS Notebook access. Use this optional API to customize usage, blocking behavior, result conversion or rendering:

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
| `usage` | Callable contract with arguments. Only `promptGuidelines` accompany it, not native descriptions, snippets or schemas |
| `discovery: "help"` | Opt in only when an empty call returns usage without performing an operation. The prompt lists the capability without a call signature. Omit `usage` to generate the no-argument help call |
| `toolName` | Non-default Responses namespace |
| `resultValue` | Structured JavaScript result instead of ordinary model-visible content |
| `blocking` | `true` or an input predicate to hold the turn. Otherwise long calls can yield to `wait` |
| `deferLoading` | Omit startup usage. Complete contracts remain discoverable in `ALL_TOOLS` |
| `kind: "freeform"` | Use `prepareInput` to map a string into normal Pi parameters |
| `isActive` | Gate a session-specific tool. Keep returning its definition and call `registration.refresh()` when activation changes |

Activation is also sampled at normal session and input boundaries. Prompt, registry and outer-tool filtering then stay fixed through the run.

Working integrations include [`pi-ask`](../pi-ask) for blocking UI, [`pi-better-skills-tool`](../pi-better-skills-tool) and [`pi-browser`](../pi-browser) for freeform input, [`pi-codex-web-run`](../pi-codex-web-run) and [`pi-codex-imagegen`](../pi-codex-imagegen) for namespaced structured results, and [`pi-shepherdr`](../pi-shepherdr) for activation and per-call blocking.

### GPT prompt mode

The optional `@howaboua/pi-codex-conversion/prompt-mode` export provides `registerGptPromptMode(pi, apply)`. The synchronous `apply(active, context)` callback selects your extension's own compact wording before prompt and tool capture. Re-register native definitions only when their text changes. Return their current `name`, `promptSnippet` and `promptGuidelines` so the prepared prompt uses the same metadata. Keep tool names, arguments and execution unchanged.

The returned registration exposes `active` for help and nested-tool providers, plus `dispose()`. Registration works in either load order and disposes on shutdown. Without an active PCC adapter the mode is false. Optional integrations should retain ordinary wording when the module is unavailable. Do not compress user content, project instructions or other extensions' text.

See [PCC GPT prompt mode](../../docs/extension-apis.md#pcc-gpt-prompt-mode) for the callback contract, preparation timing and an integration example.

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

### Agent relationships and Notes sharing

The optional `@howaboua/pi-codex-conversion/agent-relationship` API exposes `connectCodexAgentRelationships(pi)`. Its live `service.bind(ctx, relationship)` records immutable parent linkage, worker classification and optional cache affinity. `service.cacheAffinityId(ctx)` returns the effective routing identity. This is independent of Notes and does not grant shared history. Shepherdr binds fresh workers automatically. Resume preserves linkage; forks do not inherit it.

Notes owns family identity, child binding and routed notes/history through `connectNotesContextSharing` from `@howaboua/pi-notes-compaction/context-sharing`. Your orchestrator owns authenticated transport and process lifecycle. See the [extension API guide](../../docs/extension-apis.md#connecting-an-ordinary-subagent-extension-through-notes) for both contracts.

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
