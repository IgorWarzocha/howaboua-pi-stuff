# pi-shepherdr

One persistent agent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr combines a monitored [Herdr](https://herdr.dev) fleet with blocking and asynchronous agent calls. It registers one routed `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous calls return after dispatch, then push completion, failure or blockage into the controller with a steer message. The model never has to poll. Blocking calls hold the tool call and return the worker's reply directly.

With Pi Codex's compatible custom developer-message API active, asynchronous worker reports and orchestration toggles use the Responses developer role while retaining their normal display and session restoration. Without that API or adapter, delivery remains ordinary Pi custom messages. Blocking results stay in the tool response.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

Requires Pi 1.2.0 or newer, Node.js 22.18 or newer, Herdr 0.9 or newer and the Herdr Pi integration:

```bash
herdr integration install pi
```

Do not load Pi Codex's example `agents.toml` custom tool alongside Shepherdr; they own the same agent surface.

Pi Codex is optional. Without it, Shepherdr remains a normal Pi extension.

## Control panel

The agent tool is always available in Pi, Code Mode and Notebook Mode. Run Pi inside Herdr to connect the fleet and start monitoring automatically. Open the control panel with:

```text
/herdr
```

**Settings** contains orchestration preferences, agent command guidance and the global config path. **Status** shows machine connections and reconnect actions. **Connections** adds SSH machines through Herdr's setup flow. Agents handle discovery, attachment and detachment through the `agents` tool, not this panel.

`/herdr` is Shepherdr's only entry point. Outside the TUI, it reports status without changing it. An orchestration change records one visible guidance message without triggering a turn. Resumed sessions restore their last mode; new sessions start with normal guidance. The current guidance returns when a new model context no longer contains it, including turns started by worker messages. Tool availability and monitoring do not depend on this mode.

To add a machine, enter an SSH target or alias, a label and an optional remote session under **Connections**. Herdr performs setup in the terminal and asks before installing or replacing its remote server. OpenSSH owns authentication; Shepherdr does not store credentials. Profiles remain in Herdr's existing catalog, where they can also be renamed, disabled or removed.

Shepherdr connects enabled profiles at session startup. **Status** refreshes the catalog and retries failed connections or incomplete monitoring without dropping working connections. A catalog refresh stops watches for disabled or removed profiles without stopping remote agents.

Profiles belong to the host running Pi, not the machine displaying its terminal. Omit `machine` for local agent calls. `list` and `find` search all machines unless filtered. Explicit `local` also means the host running Pi. For remote calls, use the opaque profile ID returned by `list`, not its label or hostname. Renaming a profile changes its label, not its routing identity.

Remote machines connect over noninteractive SSH. The target needs `node` on its SSH PATH, Herdr 0.9 or newer, the Herdr Pi integration and a running Herdr session. Shepherdr installs managed transport helpers under `~/.pi/agent` on each remote, runs them only for the connection lifetime and leaves no remote daemon behind. Herdr's multi-machine UI does not expose a cross-machine automation socket, so Shepherdr still owns its remote transport and Pi transcript reads.

### Migrating from separate Shepherdr machines

`shepherdr.json` is no longer read. Existing Herdr profiles are used directly. Configure any missing profiles in Herdr on the host running Pi. Old machine aliases are not migrated. Legacy watches, including local watches, are cleared with a notice because they cannot distinguish explicit subscriptions from accidental ones. Re-select any ongoing watches explicitly.

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

`spawn` and `assign` block by default. Set `blocking: false` when the controller should continue other work immediately. A profile's `blocking` setting overrides the call for `spawn`. Task completion and blockage are then delivered automatically.

Blocking calls can run in parallel. In Code or Notebook, use `await Promise.allSettled([...])` to start independent calls together and wait for every result, including failures. Keep blocking enabled when the controller must wait, such as for parallel reviews. Consecutive `await` calls still run one after another; `Promise.all` can exit early on failure.

Nonblocking extension messages notify the controller once; blocking messages arrive with the worker's blocked result. Both remain visible in `read` and later task reports until the producer closes them. Each replyable message includes a ready `reply` call with its machine, target, extension and message ID. Fill in the extension's reply template. `send` does not resolve an extension message.

`reply` returns the extension's receipt after semantic delivery. Blocking messages also wait for resumed work unless another call already owns that wait. Nonblocking replies do not wait for the worker's task to finish. Shepherdr forwards strings unchanged. The producing extension owns their meaning, validation and retries.

Use `send` for messages and work updates without waiting or adding supervision. Use `assign` when you need the result: it also accepts updates to running work, sharing that work's pending result rather than replacing it. If another call is already waiting, the update returns after submission and leaves that waiter intact. Close finished workers silently instead of waking them with completion acknowledgements or shutdown notices.

Delegation and explicit `watch` keep reporting subsequent work until `unwatch` or the agent's pane closes. Finishing or failing a task clears that task, not its watch. Follow-up messages through `send` retain completion reporting without replacing the task.

Every `spawn` needs an `agent_type` and a concise `label`. The label names both the Herdr tab and Pi session; the routing `name` remains optional and is derived from it when omitted.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

After Pi compaction or Notes context rollover, the controller receives its supervised agents' exact machine and target, submitted tasks and follow-up instructions, and last observed status, including settled and blocked workers. Read a target for its reply or pending extension messages. This reminder does not start a turn or bypass normal turn preparation.

Prompts sent through `agents` identify peer messages versus delegated tasks and include the sender's host, session, workspace, tab and pane identity, with current names. Reports include source workspace and tab names too. Raw `herdr agent prompt` calls bypass this attribution. These are runtime locations, not the desktop window showing a pane.

Messages sent through `agents` bypass the receiving Pi editor, preserving unsent drafts. Update and reload Shepherdr on receiving agents as well as controllers. If a receiver is unavailable, delivery fails without pasting into its terminal. Raw `herdr agent prompt` still uses terminal input and does not provide this protection.

Messages beginning with `/` use the target Pi session's command, skill and prompt-template expansion, with sender attribution kept out of the arguments. Skills and templates retain normal task waiting. Prompt templates remain supported, but you must tell your agent which templates exist separately. When Pi Codex Conversion is installed, update and reload it too.

### Agent commands

Call `agents` with `{ commands: true }` to list this session's available slash commands and descriptions without executing them. Add `target` and optionally `machine` to inspect another session, including a busy one. Current-session discovery also works outside Herdr. `machine` alone is rejected because it does not identify a session. Skills and prompt templates are not included.

These built-in commands are available through agent messages without an allowlist:

| Command                   | Result                                           |
| ------------------------- | ------------------------------------------------ |
| `/quit`                   | Shut down Pi gracefully and close its Herdr pane |
| `/model <provider/model>` | Change the model                                 |
| `/thinking <level>`       | Change the thinking level                        |
| `/name <name>`            | Rename the session                               |
| `/new`                    | Start a new session                              |
| `/reload`                 | Reload Pi resources                              |
| `/resume <path>`          | Resume the session at the supplied path          |
| `/compact [instructions]` | Compact the session with optional instructions   |

Custom extension commands must be both registered in the receiving Pi session and allowed in its global user config. **Settings → Agent commands** shows the actual config path. The file is `pi-shepherdr.json` in Pi's agent directory, normally `~/.pi/agent`. Add `extensionCommands`, preserving any existing fields:

```json
{
	"extensionCommands": {
		"my-command": "Run my custom extension action"
	}
}
```

Keys are command names without `/`; values are nonempty descriptions. Only the global user config grants permission. A repository's `.pi/pi-shepherdr.json` cannot allow commands. The config is read on each call. A missing allowlist allows no custom extension commands; malformed config grants none.

Blocked commands return the built-in commands and currently registered, allowed extension commands. Commands return `commandSubmitted: true` without adding a task watch, even through `spawn` or `assign`. Submission does not confirm command success, except `/quit`, which waits for Pi to exit and its pane to close. Built-in commands other than `/quit` require an idle target. Skills and prompt templates keep their existing behavior.

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

Supply both booleans and enable at least one. `context` shares notes and history through aliases without changing either session's original context identity or moving its notes. `contextAgent` addresses the target from the controller; `controllerContextAgent` addresses the controller from the target. Use these paths as `history`'s `agent_name` or as `<agent>/notes/<path>` for notes. Each agent's relative note paths remain its own. The target receives its controller alias without starting a turn.

Context attachment requires compatible Notes Compaction in both sessions. Each owner keeps its original identity and local notes. Optional encrypted historical reads require compatible PCC transport and the original account and backend. The explicit `context: true` choice does not depend on the controller's spawn-sharing setting. If attachment changes context access during an exec cell, start a new cell before using notes or history.

`board: true` requires Pi Agent Board loaded in both sessions. It joins the controller's enabled board and returns `boardAgent` for subscriptions and notifications. The target's previous board archive stays untouched. If the folders differ, that archive remains in its original folder rather than becoming part of the controller's archive. Board-only attachment works without Notes or Codex Conversion.

The target must be idle and both Pi sessions must be saved. Existing shared-context members and controllers with context children cannot be context targets. Existing board members and roots with board children cannot switch boards. A target supports one controller and one fixed set of attachment choices. Attachment starts no task or watch; `assign` and `send` never attach implicitly.

Attachments survive resume, not forks. Live notes and history access needs the owning Pi processes and machine connections. After an interrupted attachment, resume the original sessions and retry the same target and choices. Retries reuse the original aliases and membership.

To detach, call `agents` with `action: "detach"`, the same target, and both booleans. Enable each membership you want to leave. Context detach retains counterpart notes under the existing aliases read-only. Local notes use captured checkpoints. Historical Remote references retain their original authenticated address, not a plaintext snapshot. Counterpart history and writes stop at detach. Native identities remain unchanged. Board detach restores the target's previous board without deleting either archive. Board members with children cannot detach. Reattachment is unsupported.

If an attached owner closes, local note reads use its latest saved checkpoints when the source machine and session file remain reachable. Otherwise they return the timestamped attachment snapshot, marked stale with the access failure. This never writes to the owner's session. Historical encrypted reads require their original account and backend. Backend failures remain visible. An incomplete detach fails with a retry instruction rather than claiming success.

## Message board

Boards are provided by the separate [Pi Agent Board](../pi-agent-board) extension. Install it in every participating Pi session, then reload:

```sh
pi install npm:@howaboua/pi-agent-board
```

The same discussions, subscriptions and saved history continue without migration. Pi Agent Board owns the `board` tool, settings and `/board` browser viewer. Shepherdr has no fallback board or board controls under `/herdr`. If a saved board setting is on but the extension is missing, Shepherdr displays an installation warning once per session. Saved settings and archives remain untouched. Pi Codex Conversion is optional.

Shepherdr supplies family membership, attachments and remote routing. Children spawned while the board is enabled inherit its location and board ID even with another working directory. The spawn result's `boardAgent` is their address for subscriptions and explicit notifications, distinct from a pane or shared-notes identity. Independently started agents, existing `assign` targets and children spawned while it is off do not join automatically. Use explicit `attach` to join an existing agent. Board identity is independent of orchestration mode, shared notes and `share_context`.

Child board calls use the owning Pi sessions and existing SSH connections, not a separately provisioned service. The root and intermediate controllers must be running as processes, but need not be in an active model turn. Resume the owner and reconnect under `/herdr` → **Status** after a lost connection. Future root sessions can browse the archive even when the old owner is offline. A fork starts a new independent identity. Profiles selecting an existing session cannot bind to an enabled board through `spawn`; use `attach` followed by `assign` instead.

## Shared notes and history

With compatible Pi Codex Conversion on both ends, Shepherdr marks fresh spawned workers before their first task with their immediate parent's native Pi session ID and `subagentKind: "collab_spawn"`. Workers also inherit the parent's effective cache routing identity, including nested and remote spawns. Each worker keeps its own native session, sockets and history. Cache routing works with shared notes disabled and does not grant notes access or copy the parent's transcript. Only matching prompt prefixes can benefit. Resume preserves the relationship; forks and profiles selecting existing sessions do not acquire it. Older PCC versions retain ordinary delegation and any supported parent linkage. The [extension API guide](../../docs/extension-apis.md#parent-and-worker-relationships) documents PCC's service contract for other orchestrators. Shepherdr owns transport, not a separate public relationship RPC API.

With Notes Compaction on both ends, enable **Share subagent context** under `/notes` in the controller. It is off by default. Shared `spawn` gives each child a unique context identity before its first turn; `contextAgent` identifies its notes and history. Nested spawns stay in the same family. Turning sharing off affects new spawns only. Existing identity survives resume. `assign` and independently started agents remain unchanged.

Set `"share_context": false` in a profile to keep its new workers' notes and history independent even when controller sharing is enabled. Omission or `true` follows the controller setting, never turns sharing on itself. This separates context, not filesystem permissions or information included in the task.

Pi creates each worker session normally. The worker records its shared identity before Shepherdr delivers the first task; no pre-created session file or launch override is needed.

Shared notes route through their owning Pi sessions and existing SSH connections. Those owners and intermediate controllers must be running. Resume the owner and reconnect under `/herdr` → **Status** after a connection loss. No note store is copied or silently substituted. New writes stay local; optional hybrid lookup is read-only.

Shepherdr works without Notes or PCC. A target without active Notes sharing still starts independently with a warning. Invalid bindings fail before task delivery. Profiles selecting existing sessions cannot participate in shared `spawn`; use `attach`, then `assign`.

## Profiles

On first load, Shepherdr installs three editable profiles:
- `general` uses `openai-codex/gpt-6-sol` with `high` thinking for implementation
- `explorer` uses `openai-codex/gpt-6-luna` with `high` thinking for read-only discovery
- `reviewer` uses `openai-codex/gpt-6-luna` with `xhigh` thinking for generic read-only review

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
- `blocking`: `true` forces blocking spawns, `false` forces asynchronous spawns. Omission respects the call's `blocking` value, which defaults to `true`. This does not affect `assign` to existing agents.
- `share_context`: `false` opts new spawns out of shared notes and history. Omission or `true` follows the controller setting.

`help` and `list` expose each profile's description and configured settings. Profile names carry no blocking policy. The bundled reviewer profile sets `"blocking": true`; change it to `false` to force asynchronous review, or remove it to choose per call. Existing installed profiles are never overwritten. An existing reviewer without `blocking` now respects the call like any other profile.

## Advanced Herdr control

Ordinary delegation stays inside `agents`. For workspace, tab, pane, process, focus, layout or raw-terminal operations, run `herdr --skill` and follow the installed Herdr skill. Shepherdr does not duplicate those controls.

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

## Pulse runner

Shepherdr implements Pulses' optional detached-runner contract through Pi events. Pulses owns scheduling. Each worker runs in a separate Pi process, so the main agent remains available. Its final response returns through the same monitored waking delivery as asynchronous `agents` calls, including ordinary kickoff preparation and rollover admission. There is no passive-result or blocking execution mode.

The adapter reuses owned saved sessions, refuses overlapping work and verifies parent session, branch and pane identity. Worker receipts are opaque to Pulses. Use ordinary Shepherdr controls to manage worker panes. Detached pulse workers cannot become schedulers themselves.

Fresh and restored workers use the `general` profile's model, thinking level and explicit Pi arguments without its implementation-role prompt. Ordinary agent spawns still use the complete profile. Fresh workers inherit the existing family board independently of their working directory, alongside optional shared Notes and cache affinity. The adapter does not choose an output destination or keep the controlling Pi alive.

## License

MIT
