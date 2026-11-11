# pi-shepherdr

One persistent agent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr combines a monitored [Herdr](https://herdr.dev) fleet with blocking and asynchronous agent calls. It registers one routed `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous calls return after dispatch, then push completion, failure or blockage into the controller with a steer message. The model never has to poll. Blocking calls hold the tool call and return the worker's reply directly.

With Pi Codex's compatible custom developer-message API active, asynchronous worker reports and orchestration toggles use the Responses developer role while retaining their normal display and session restoration. Without that API or adapter, delivery remains ordinary Pi custom messages. Blocking results stay in the tool response.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

Requires Pi 1.5 or newer, Node.js 22.19 or newer and Herdr Core 0.1.18 or newer. Run Pi in a Core terminal, through `hc` or a Herdr app connected to that Core. Shepherdr reports Pi status to Core and discovers other Pi sessions with Shepherdr installed. No separate Pi integration is needed.

Do not load Pi Codex's example `agents.toml` custom tool alongside Shepherdr; they own the same agent surface.

Shepherdr installs and runs on its own. Pi Codex, shared Notes and boards are optional. Delegation, supervision, messages, focus and orchestration work without them. Shared Notes require Notes Compaction 0.0.15 or newer; boards require Agent Board 0.0.5 or newer. [Agent Comms](../pi-agent-comms) also provides both integrations when loaded. Enable each shared feature in every participating session.

Workers start as background Core terminals by default. Use `placement: "new_workspace"` for a new app workspace, or `placement: "new_tab"` with a `workspace` ID advertised by a live terminal on the target Core. A connected Herdr app adopts these terminals. Pane placement is no longer supported. Focus requires a Herdr app window running on the target Core's machine and connected to that Core.

Ordinary workers end when their parent's program exits. Active remote connections also verify Core's parent links and close ordinary children when Core misses cross-machine cleanup. Detached workers remain independent. Restoring a Pi session preserves its saved worker identity. `/root` follows saved spawn ancestry, not shared Notes or Board membership. Older workers without saved ancestry must use exact session references for messages.

For remote Core workers, add machines with `hc machine add` and install Node.js, Herdr Core and Shepherdr on each target. Delegation, supervision, shared context and boards work across those machines.

### Migrating from the older Herdr TUI

Current Shepherdr is Core-native and is not backward-compatible with the legacy Herdr TUI. Shepherdr 0.2.27 was the last release supporting it. Its [source is available for forks](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/5ede06bdc32da2b513f0709966af1f32908f243c/packages/pi-shepherdr), but the legacy version is unmaintained.

Update and restart controllers and workers together. The older Herdr backend, SSH bridge, machine catalogue and legacy environment overrides are no longer used. Existing Herdr TUI sessions cannot migrate to Core. Start fresh Core terminals and configure remote machines with `hc machine add` on the host running Pi.

When switching from the older TUI or another Core namespace, explicitly select the agents you want to watch again. Saved addresses from the previous namespace are not transferable.

## Control panel

The agent tool is always available in Pi, Code Mode and Notebook Mode. Run Pi inside Core to connect the fleet and start monitoring automatically. Open the control panel with:

```text
/herdr
```

**Settings** contains orchestration preferences, agent command guidance and the global config path. **Status** shows machine connections and reconnect actions. **Connections** adds machines to Core's catalogue. Agents handle discovery, attachment and detachment through the `agents` tool, not this panel.

Run `/herdr close-idle` to close idle child sessions spawned by the current session branch. Attached or assigned existing sessions are never included. Busy, blocked, unavailable or unverified children stay open. Children spawned before this feature was installed have no ownership receipt and stay open too. Pi shuts down gracefully before its Core terminal closes.

`/herdr` is Shepherdr's only entry point. Outside the TUI, it reports status without changing it. An orchestration change records one visible guidance message without triggering a turn. Resumed sessions restore their last mode; new sessions start with normal guidance. The current guidance returns when a new model context no longer contains it, including turns started by worker messages. Tool availability and monitoring do not depend on this mode.

Under **Connections**, enter an SSH target or alias, a machine name and an optional Core session. The panel runs `hc machine add <target> --name <name>` with `--session <session>` when supplied. Core owns installation approvals and the catalogue. OpenSSH owns authentication; Shepherdr does not store credentials or maintain another catalogue.

**Status** refreshes the Core catalogue and retries failed connections or incomplete monitoring without dropping working connections. Removing a machine stops its watches without stopping its agents.

Machines belong to the host running Pi, not the machine displaying its terminal. Omit `machine` for local agent calls. `list` and `find` search all machines unless filtered. The reserved selector `local` always means the host running Pi. Remote calls accept an exact current machine name or a stable Core ID returned by `list`. Duplicate names require an ID. Hostnames and old aliases are not inferred. Refresh **Status** after renaming a machine. Watches and saved routes retain its stable ID across name changes.

Remote file watches, Notes, shared-context calls and peer messages use a private Core-owned helper, started lazily and kept alive over a flow-controlled terminal attachment. Shepherdr does not install SSH bridge files or poll through `machine.exec`. Voice focus uses a separate private helper so large Notes transfers do not block its channel. Monitoring uses each Core's own snapshot rather than treating a missing machine in an aggregate terminal list as closed agents.

The same connection supervises native remote-parent lifetimes while active. A brief closing grace makes a best-effort check for Pi exiting. No separate background service is installed. A disconnected or unreachable parent is not treated as dead. Failed checks leave existing agents available and produce a warning while the connection is active. Reconnect the parent Core or close its children explicitly. Closing checks have no persistent warning report. This does not guarantee cleanup after an OS failure or a prolonged Pi shutdown.

## Agent calls

Call `agents` with `{}` before first use, alone, then send flat request objects with `action`. Code and Notebook Mode use `await tools.agents()`. Explicit `action: "help"` also returns help.

| Action    | Result                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| `help`    | Live profiles, request shapes, coordination rules and the advanced Herdr escape hatch |
| `list`    | Profiles, machines and matching Pi agents                                             |
| `find`    | Agents matching a query or status                                                     |
| `spawn`   | Spawn a profiled Pi agent and send its initial task                                   |
| `send`    | Send a peer message without waiting or subscribing                                    |
| `assign`  | Delegate a task to an existing agent                                                  |
| `attach`  | Share context or join a board with an existing idle agent                             |
| `detach`  | Leave selected membership and retain read-only counterpart checkpoints                |
| `read`    | Read the latest assistant reply or bounded terminal output                            |
| `reply`   | Deliver an opaque reply to a worker's extension                                       |
| `watch`   | Push future settlement from an existing Pi agent                                      |
| `unwatch` | Stop reporting an agent                                                               |

`spawn` and `assign` return once the task is submitted by default, so consecutive calls can dispatch work to several agents without waiting for the first task to finish. Task completion and blockage arrive automatically. Set `blocking: true` when the call must wait for its result. A profile's `blocking` setting still overrides the call for `spawn`.

Blocking calls can run in parallel. In Code or Notebook, use `await Promise.allSettled([...])` to start independent calls together and wait for every result, including failures. Keep blocking enabled when the controller must wait, such as for parallel reviews. Consecutive `await` calls still run one after another; `Promise.all` can exit early on failure.

Nonblocking extension messages notify the controller once; blocking messages arrive with the worker's blocked result. Both remain visible in `read` and later task reports until the producer closes them. Each replyable message includes a ready `reply` call with its machine, target, extension and message ID. Fill in the extension's reply template. `send` does not resolve an extension message.

`reply` returns the extension's receipt after semantic delivery. Blocking messages also wait for resumed work unless another call already owns that wait. Nonblocking replies do not wait for the worker's task to finish. Shepherdr forwards strings unchanged. The producing extension owns their meaning, validation and retries.

Use `send` for messages and work updates without adding supervision. Use `assign` to delegate work and receive its monitored result, automatically or through an explicit blocking call. It also accepts updates to running work, sharing that work's pending result rather than replacing it. If another call is already waiting, the update returns after submission and leaves that waiter intact. Close finished workers silently instead of waking them with completion acknowledgements or shutdown notices.

When a parent sends or assigns work to one of its closed workers, Shepherdr reopens that worker's saved Pi session before delivering the message. Use its session reference, previous terminal target or saved routing name. The result reports `resumed: true` and the current target. This applies only to children recorded in the parent's selected session branch, not arbitrary peers or attachments. The saved session and its original machine must remain accessible. `/quit` never reopens a closed worker.

Delegation and explicit `watch` keep reporting subsequent work until `unwatch` or the agent's terminal closes. Finishing or failing a task clears that task, not its watch. Follow-up messages through `send` retain completion reporting without replacing the task.

Every `spawn` needs an `agent_type` and a concise `label`. The label names the Pi session. The routing `name` remains optional and is derived from the label when omitted.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

After Pi compaction or Notes context rollover, the controller receives its supervised agents' exact machine and target, submitted tasks and follow-up instructions, and last observed status, including settled and blocked workers. Read a target for its reply or pending extension messages. This reminder does not start a turn or bypass normal turn preparation.

Prompts sent through `agents` identify peer messages versus delegated tasks and include the sender's host and session identity. Core reports use terminal addresses and include app location IDs when available. These are runtime locations, not the desktop window showing a terminal.

Messages sent through `agents` bypass the receiving Pi editor, preserving unsent drafts. Update and restart Shepherdr on receiving agents as well as controllers. If a receiver is unavailable, delivery fails without pasting into its terminal.

Messages beginning with `/` use the target Pi session's command, skill and prompt-template expansion, with sender attribution kept out of the arguments. Skills and templates retain normal task waiting. Prompt templates remain supported, but you must tell your agent which templates exist separately. When Pi Codex Conversion is installed, update and reload it too.

### Agent commands

Call `agents` with `{ commands: true }` to list this session's available slash commands and descriptions without executing them. Add `target` and optionally `machine` to inspect another session, including a busy one. Current-session discovery also works outside Herdr. `machine` alone is rejected because it does not identify a session. Skills and prompt templates are not included.

These built-in commands are available through agent messages without an allowlist:

| Command                   | Result                                              |
| ------------------------- | --------------------------------------------------- |
| `/quit`                   | Shut down Pi gracefully and close its Core terminal |
| `/model <provider/model>` | Change the model                                    |
| `/thinking <level>`       | Change the thinking level                           |
| `/name <name>`            | Rename the session                                  |
| `/new`                    | Start a new session                                 |
| `/reload`                 | Reload Pi resources                                 |
| `/resume <path>`          | Resume the session at the supplied path             |
| `/compact [instructions]` | Compact the session with optional instructions      |

Custom extension commands must be both registered in the receiving Pi session and allowed in its global user config. **Settings → Agent commands** shows the actual config path. The file is `pi-shepherdr.json` in Pi's agent directory, normally `~/.pi/agent`. Add `extensionCommands`, preserving any existing fields:

```json
{
	"extensionCommands": {
		"my-command": "Run my custom extension action"
	}
}
```

Keys are command names without `/`; values are nonempty descriptions. Only the global user config grants permission. A repository's `.pi/pi-shepherdr.json` cannot allow commands. The config is read on each call. A missing allowlist allows no custom extension commands; malformed config grants none.

Blocked commands return the built-in commands and currently registered, allowed extension commands. Commands return `commandSubmitted: true` without adding a task watch, even through `spawn` or `assign`. Submission does not confirm command success, except `/quit`, which waits for Pi to exit and its terminal to close. Built-in commands other than `/quit` require an idle target. Skills and prompt templates keep their existing behavior.

Idle messages start a custom-message turn through Pi’s complete preparation chain. Messages arriving during a run use steering, promoted to developer messages when Pi Codex developer delivery is active. Otherwise they remain ordinary Pi custom messages.

### Extension messages

An extension can publish a durable message without importing Shepherdr:

```ts
pi.appendEntry("shepherdr-extension-message", {
	version: 1,
	extension: "your-extension",
	id: "unique-message-id",
	state: "pending",
	message: "Extension-authored text for the controller",
	reply: "Extension-authored reply template", // optional
	blocking: false,
});
```

Use a unique ID per message within the extension. `blocking` says whether replying should wait for resumed work. Omit `reply` for messages requiring human handling. Close a message with another entry using the same `version`, `extension` and `id`, and `state: "closed"`. Local and remote readers follow the active session branch and expose every pending record.

Register the reply handler on Pi's event bus:

```ts
pi.events.on("@howaboua/pi-shepherdr/extension-reply/v1", (event) => {
	const { extension, id, message, respond } = event;
	if (extension !== "your-extension") return;
	respond(handleReply(id, message));
});
```

Claim synchronously with `respond(string | Promise<string>)`. Resolve only after delivering the response and persisting its resulting state. Reject through that promise for validation or delivery errors. Shepherdr returns the opaque result string. Each extension owns one handler and must guard its session lifetime and retry semantics.

Replies use the authenticated peer connection, including across machines, and can reach busy or blocked workers without starting a model turn. Missing handlers fail visibly. An unacknowledged delivery can still have reached its handler, so inspect the target before retrying. Update and reload Shepherdr on both ends and any producing extension that used the previous Ask-specific integration.

### Attach existing agents

Use `attach` before delegating when an independently started agent needs shared notes, history or board membership:

```js
await tools.agents({
	action: "attach",
	target: "<target from find>",
	context: true,
	board: true,
});
```

Enable one or both choices. Omitted choices are false. `context` shares notes and history through aliases without changing either session's original context identity or moving its notes. The returned `agent` is the target's Pi session reference. Use it as `history`'s `agent_name` or as `<agent>/notes/<path>` for notes. Each agent's relative note paths remain its own. The target receives its controller reference without starting a turn.

Context attachment requires active Notes in both sessions, through Notes Compaction or Agent Comms. Each owner keeps its original identity and local notes. Optional encrypted historical reads require compatible PCC transport and the original account and backend. The explicit `context: true` choice does not depend on the controller's spawn-sharing setting. If attachment changes context access during an exec cell, start a new cell before using notes or history.

`board: true` requires Agent Board or Agent Comms loaded in both sessions. It joins the controller's enabled board. Use the returned `agent` for subscriptions and notifications. The target's previous board archive stays untouched. If the folders differ, that archive remains in its original folder rather than becoming part of the controller's archive. Board-only attachment works without Notes or Codex Conversion.

The target must be idle and both Pi sessions must be saved. Existing shared-context members and controllers with context children cannot be context targets. Existing board members and roots with board children cannot switch boards. A target supports one controller and one fixed set of attachment choices. Attachment starts no task or watch; `assign` and `send` never attach implicitly.

Attachments survive resume, not forks. Saved checkpoints remain readable without the owning Pi process when its saved session and machine are accessible. Writes and live history access need the owner. After an interrupted attachment, resume the original sessions and retry the same target and choices. Retries reuse the original aliases and membership.

To detach, call `agents` with `action: "detach"`, the same target, and each membership you want to leave set to true. Omitted memberships are unchanged. Context detach retains counterpart notes under the existing aliases read-only. Local notes use captured checkpoints. Historical Remote references retain their original authenticated address, not a plaintext snapshot. Counterpart history and writes stop at detach. Native identities remain unchanged. Board detach restores the target's previous board without deleting either archive. Board members with children cannot detach. Reattachment is unsupported.

If an attached owner closes, local note reads use its latest saved checkpoints when the source machine and session file remain reachable. Otherwise they return the timestamped attachment snapshot, marked stale with the access failure. This never writes to the owner's session. Historical encrypted reads require their original account and backend. Backend failures remain visible. An incomplete detach fails with a retry instruction rather than claiming success.

## Message board

Install Agent Board in every participating Pi session, then reload:

```sh
pi install npm:@howaboua/pi-agent-board
```

The loaded Board extension owns the `board` tool, `/board` settings and read-only browser viewer. Agent Comms can provide the same integration instead of Agent Board, retaining discussions, subscriptions and saved history. Do not load both Board providers together. Shepherdr has no fallback board or board controls under `/herdr`. If a saved session board setting is on but its provider is missing, Shepherdr displays a warning once per session. Saved settings and archives remain untouched. Pi Codex Conversion is optional.

Shepherdr supplies family membership, attachments and remote routing. Children spawned while the board is enabled inherit its location and board ID even with another working directory. The spawn result's `agent` is their Pi session reference for subscriptions, notifications and shared notes. The `sharing` flags report which memberships are active. Independently started agents, existing `assign` targets and children spawned while it is off do not join automatically. Use explicit `attach` to join an existing agent. Board identity is independent of orchestration mode, shared notes and `share_context`.

Child board calls use the owning Pi sessions and Core connections, not a separately provisioned service. The root and intermediate controllers must be running as processes, but need not be in an active model turn. Resume the owner and reconnect under `/herdr` → **Status** after a lost connection. Future root sessions can browse the archive even when the old owner is offline. A fork starts a new independent identity. Profiles selecting an existing session cannot bind to an enabled board through `spawn`; use `attach` followed by `assign` instead.

## Shared notes and history

With compatible Pi Codex Conversion on both ends, Shepherdr marks fresh spawned workers before their first task with their immediate parent's native Pi session ID and `subagentKind: "collab_spawn"`. Workers also inherit the parent's effective cache routing identity, including nested and remote spawns. Each worker keeps its own native session, sockets and history. Cache routing works with shared notes disabled and does not grant notes access or copy the parent's transcript. Only matching prompt prefixes can benefit. Resume preserves the relationship; forks and profiles selecting existing sessions do not acquire it. Older PCC versions retain ordinary delegation and any supported parent linkage. The [extension API guide](../../docs/extension-apis.md#parent-and-worker-relationships) documents PCC's service contract for other orchestrators. Shepherdr owns transport, not a separate public relationship RPC API.

Install Notes Compaction in every participating session and reload, or use Agent Comms' Notes feature. Do not load both Notes providers together. With Notes active on both ends, enable **Share subagent context** under `/notes` in the controller. It is off by default. Shared `spawn` gives each child a unique context identity before its first turn; the returned `agent` identifies its notes and history. Nested spawns stay in the same family. Turning sharing off affects new spawns only. Existing identity survives resume. `assign` and independently started agents remain unchanged.

```sh
pi install npm:@howaboua/pi-notes-compaction
```

Set `"share_context": false` in a profile to keep its new workers' notes and history independent even when controller sharing is enabled. Omission or `true` follows the controller setting, never turns sharing on itself. This separates context, not filesystem permissions or information included in the task.

Pi creates each worker session normally. The worker records its shared identity before Shepherdr delivers the first task; no pre-created session file or launch override is needed.

Shared local checkpoints remain readable after workers or intermediate controllers close. Notes verifies saved family membership and reads the selected session branch. Saved reads also require the Notes provider's public reader package installed alongside Shepherdr on the controller. Cross-machine reads need a Core connection and access to the saved session, not a running Pi owner. Older sessions without a saved parent location can find family checkpoints across connected machines through their Notes index or standard Pi session directory. Writes and optional hybrid lookup still use their owning services. Reconnect machines under `/herdr` → **Status** after a connection loss.

Shepherdr works without Notes or PCC. A target without active Notes sharing still starts independently with a warning. Invalid bindings fail before task delivery. Profiles selecting existing sessions cannot participate in shared `spawn`; use `attach`, then `assign`.

## Profiles

On first load, Shepherdr installs three editable profiles:

- `general` uses `openai-codex/gpt-6-sol` with `high` thinking for implementation
- `explorer` uses `openai-codex/gpt-6-luna` with `high` thinking for read-only discovery
- `reviewer` uses `openai-codex/gpt-6-luna` with `xhigh` thinking for generic read-only review

Profiles set starting defaults, not a permanent role. Their instructions accompany the initial assignment, so the same agent can take on different work later. Notes model roles can change its model and reasoning at context rollover without replacing the agent or discarding its saved notes.

Use `general` sparingly, mainly when requested or while orchestration is active. For work in the controller's repository, create and prepare a dedicated worktree, then pass it as `cwd`.

Profiles live under:

```text
<pi-agent-directory>/shepherdr/profiles/<name>/profile.json
```

That directory is authoritative after initialization. Edit a profile to change it, add a directory to create an agent type, or delete its directory to remove it; deleted defaults are not recreated. Profiles never inherit the controller's model or thinking level.

```json
{
	"description": "Read-only dependency review",
	"model": "provider/model",
	"thinking": "high",
	"prompt": "prompt.md",
	"accepts": ["base"],
	"pi_args": []
}
```

`prompt` is read as system-prompt text. An optional `prepare` module may export `prepare({ cwd, message, base, local })` and return the worker message. Preparation runs on the controlling machine before dispatch; `local` says whether that machine also hosts the worker.

Optional profile settings:

- `blocking`: `true` forces blocking spawns, `false` forces asynchronous spawns. Omission respects the call's `blocking` value, which defaults to `false`. This does not affect `assign` to existing agents.
- `share_context`: `false` opts new spawns out of shared notes and history. Omission or `true` follows the controller setting.

`help` and `list` expose each profile's description and configured settings. Profile names carry no blocking policy. The bundled reviewer profile sets `"blocking": true`; change it to `false` to force asynchronous review, or remove it to choose per call. Existing installed profiles are never overwritten. An existing reviewer without `blocking` now respects the call like any other profile.

## Advanced Herdr control

Ordinary delegation stays inside `agents`. For terminal operations on Core, run `hc --skill`. For window operations, use `herdr-app --skill`.

Herdr still owns terminals, layout, agent processes and restored sessions. Shepherdr owns event subscriptions, remote routing, the fleet widget and purple settlement messages.

## Worker role integration

Every Shepherdr launch carries `--shepherdr-worker`, including remote workers, profiles without prompts and resumed workers. The role survives session resume after the first task. Forks do not inherit the saved role, but a fork opened inside a flagged worker process is still a worker. Existing agents reached through `assign` or `attach` are not automatically classified as workers. Pi Codex Conversion is not required.

Other extensions can query the current role synchronously through public Pi events, including during `session_start`:

```ts
let worker = false;
pi.events.emit("shepherdr:worker-role:v1", {
	sessionManager: ctx.sessionManager,
	reply: (value: boolean) => {
		worker = value;
	},
});
```

No reply means Shepherdr is unavailable. The query adds no model instructions or tools. Worker launch flags describe the process, so new sessions opened inside that process remain workers.

## Worker API

Extensions can discover the worker service through Pi events. The public types are exported from `@howaboua/pi-shepherdr/worker-api`. A type-only import keeps Shepherdr optional:

```ts
import type { WorkerService } from "@howaboua/pi-shepherdr/worker-api";

const protocol: WorkerService["protocol"] = "@howaboua/pi-shepherdr/workers/v1";
let workers: WorkerService | undefined;
pi.events.emit(`${protocol}/request`, {
	protocol,
	accept: (service: WorkerService) => {
		workers = service;
	},
});
```

No reply means the service is unavailable. Discover again after extension reload. Start work after session startup and resource discovery in a TUI session. Callers own scheduling, eligibility and whether to use `isWorker(ctx)` to exclude workers from their workflow.

`start(ctx, { scope, key, requestId, title, prompt, cwd, workerId?, lifetime? })` submits one task and returns `{ workerId, state }`. Use a stable extension-specific `scope`, a reusable worker `key` and a fresh `requestId` per task. Repeating the latest acknowledged request ID returns its existing status without resending. Persist the receipt before attempting another request. A failed call may have submitted work unless its error has `dispatched: false`. Never retry an uncertain rejection, even with the same ID. Request IDs do not make failed calls replay-safe. Inspection helps establish the outcome but does not clear the uncertain admission.

The default lifetime is `parent`. Set `lifetime: "detached"` explicitly to keep the worker running after its parent exits. Lifetime and working directory cannot change for an existing key. `inspect(ctx, scope, workerId)` reports `working`, `idle` or `closed`; `subscribe(listener)` provides change notifications and returns an unsubscribe function. Ownership is restricted to the caller's selected native session branch and scope, not an access-control boundary between trusted extensions.

Workers run in separate Pi processes. Their final responses use the same monitored delivery as asynchronous `agents` calls, including normal kickoff preparation and rollover admission. The service reuses owned saved sessions and refuses overlapping work. Fresh workers use the `general` profile without its role prompt; resumed sessions retain their saved model, thinking level and name. Fresh workers inherit the family Board and optional shared Notes and cache affinity. Use ordinary Shepherdr controls to manage worker terminals. No automation extension is required.

## License

MIT
