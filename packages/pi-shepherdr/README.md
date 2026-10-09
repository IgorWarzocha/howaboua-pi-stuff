# pi-shepherdr

One persistent agent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr combines a monitored [Herdr](https://herdr.dev) fleet with blocking and asynchronous agent calls. It registers one routed `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous calls return after dispatch, then push completion, failure or blockage into the controller with a steer message. The model never has to poll. Blocking calls hold the tool call and return the worker's reply directly.

With Pi Codex's compatible custom developer-message API active, asynchronous worker reports and orchestration toggles use the Responses developer role while retaining their normal display and session restoration. Without that API or adapter, delivery remains ordinary Pi custom messages. Blocking results stay in the tool response.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

Requires Pi 1.1.0 or newer, Node.js 22.18 or newer, Herdr 0.9 or newer and the Herdr Pi integration:

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

| Action | Result |
| --- | --- |
| `help` | Live profiles, request shapes, coordination rules and the advanced Herdr escape hatch |
| `list` | Profiles, machines and matching Pi agents |
| `find` | Agents matching a query or status |
| `spawn` | Spawn a profiled Pi agent and send its initial task |
| `send` | Send a peer message without waiting or subscribing |
| `assign` | Delegate a task to an existing agent |
| `attach` | Share context or join a board with an existing idle agent |
| `detach` | Leave selected membership and retain read-only counterpart checkpoints |
| `read` | Read the latest assistant reply or bounded terminal output |
| `answer` | Answer a worker's blocking or asynchronous Pi Ask |
| `watch` | Push future settlement from an existing Pi agent |
| `unwatch` | Stop reporting an agent |

`spawn` and `assign` block by default. Set `blocking: false` when the controller should continue other work immediately. A profile's `blocking` setting overrides the call for `spawn`. Task completion and blockage are then delivered automatically.

`answer` requires the pending `ask_id` from `read` or a question report. It handles both blocking and asynchronous Ask prompts. It returns `accepted` only when that exact Ask persisted the supplied responses; an accepted retry sends no input. Answering an asynchronous question does not wait for the worker's task to finish.

Asynchronous Ask prompts notify the controller while the worker keeps working. Session-file events drive local and remote notifications without marking the worker blocked or settling its task. Duplicate notifications are suppressed across controller restoration. Update Pi Ask on workers together with Shepherdr on controllers.

Needed input and work changes use `send`. It returns after submission, does not accept `blocking`, and never creates or changes a watch or task. Use `assign` only to delegate work whose result you need, not to exchange coordination messages. Close finished workers silently instead of waking them with completion acknowledgements or shutdown notices.

Delegation and explicit `watch` keep reporting subsequent work until `unwatch` or the agent's pane closes. Finishing or failing a task clears that task, not its watch. Follow-up messages through `send` retain completion reporting without replacing the task.

Every `spawn` needs an `agent_type` and a concise two- or three-word `label`. The label names both the Herdr tab and Pi session; the routing `name` remains optional and is derived from it when omitted.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

After Pi compaction or Pi Codex context rollover, the controller receives its active agents' exact machine and target, full delegated task and last observed status. Existing work stays assigned instead of being delegated again. This reminder does not start a turn or bypass normal turn preparation.

Prompts sent through `agents` identify peer messages versus delegated tasks and include the sender's host, session, workspace, tab and pane identity, with current names. Reports include source workspace and tab names too. Raw `herdr agent prompt` calls bypass this attribution. These are runtime locations, not the desktop window showing a pane.

Messages sent through `agents` bypass the receiving Pi editor, preserving unsent drafts. Update and reload Shepherdr on receiving agents as well as controllers. If a receiver is unavailable, delivery fails without pasting into its terminal. Raw `herdr agent prompt` still uses terminal input and does not provide this protection.

Messages beginning with `/` use the target Pi session's command, skill and prompt-template expansion, with sender attribution kept out of the arguments. Skills and templates retain normal task waiting. Prompt templates remain supported, but you must tell your agent which templates exist separately. When Pi Codex Conversion is installed, update and reload it too.

### Agent commands

These built-in commands are available through agent messages without an allowlist:

| Command | Result |
| --- | --- |
| `/quit` | Shut down Pi gracefully and close its Herdr pane |
| `/model <provider/model>` | Change the model |
| `/thinking <level>` | Change the thinking level |
| `/name <name>` | Rename the session |
| `/new` | Start a new session |
| `/reload` | Reload Pi resources |
| `/resume <path>` | Resume the session at the supplied path |
| `/compact [instructions]` | Compact the session with optional instructions |

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

Idle messages start a prepared user turn. Messages arriving during a run use steering, promoted to developer messages when Pi Codex developer delivery is active. Otherwise they remain ordinary Pi custom messages.

For `answer` inside Code or Notebook Mode, update Pi Ask on workers together with Shepherdr on controllers.

### Attach existing agents

Use `attach` before delegating when an independently started agent needs shared notes, history or board membership:

```js
await tools.agents({ action: "attach", target: "<target from find>", context: true, board: true })
```

Supply both booleans and enable at least one. `context` shares notes and history through aliases without changing either session's original context identity or moving its notes. `contextAgent` addresses the target from the controller; `controllerContextAgent` addresses the controller from the target. Use these paths as `history`'s `agent_name` or as `<agent>/notes/<path>` for notes. Each agent's relative note paths remain its own. The target receives its controller alias without starting a turn.

Context attachment requires updated Codex Conversion with Local, Tree or Remote storage. Each owner keeps its original context identity and storage, including when the two agents use different stores. Remote access uses the reader's active Codex transport and requires the original account and backend, regardless of provider name. The explicit `context: true` choice does not depend on the controller's spawn-sharing setting. Use Code or Notebook with ordinary query and text for mixed-storage search and writes. Direct sensitive calls cannot cross between encrypted Remote arguments and ordinary Local or Tree arguments. If attachment changes context access during an exec cell, start a new cell before using notes or history.

An account mismatch rejects context sharing. Each agent keeps its own notes and history. If the account changes after attachment, pinned Remote notes become unavailable, including native Remote notes. Notes do not move to a new account or another store. Use messages to exchange the context the other agent needs.

`board: true` requires Pi Agent Board loaded in both sessions. It joins the controller's enabled board and returns `boardAgent` for subscriptions and notifications. The target's previous board archive stays untouched. If the folders differ, that archive remains in its original folder rather than becoming part of the controller's archive. Board-only attachment works without Codex Conversion and with Remote context storage.

The target must be idle and both Pi sessions must be saved. Existing shared-context members and controllers with context children cannot be context targets. Existing board members and roots with board children cannot switch boards. A target supports one controller and one fixed set of attachment choices. Attachment starts no task or watch; `assign` and `send` never attach implicitly.

Attachments survive resume, not forks. Local and Tree live access needs the owning Pi processes and machine connections. Remote access uses authenticated backend references rather than the owner's running process. After an interrupted attachment, resume the original sessions and retry the same target and choices. The target may already have joined even when the controller reports failure; retries reuse the original aliases and membership rather than creating duplicates.

To detach, call `agents` with `action: "detach"`, the same target, and both booleans. Enable each membership you want to leave. Context detach retains counterpart notes under the existing aliases read-only. Local and Tree notes use captured checkpoints. Remote notes retain an authenticated reference to the original owner's saved backend notes, not a frozen plaintext snapshot. Counterpart history and writes stop at detach. Native notes and history keep their original identities. Board detach restores the target's previous board and stops its shared-board notifications without deleting either archive. Board members with children cannot detach. Reattachment is unsupported.

If an attached owner closes or dies, Local and Tree notes reads first use its latest saved checkpoints when the source machine and session file remain reachable. This needs no running owner process and never writes to its session file. If the source is unavailable, reads return the timestamped snapshot captured at attachment, explicitly marked stale with the access failure. No latest-checkpoint guarantee is possible for a disconnected source machine or unsaved notes. Local and Tree counterpart history still requires its live owner. Remote notes and history remain reachable through the backend with the original account and backend. Backend failures stay visible without a local fallback. An incomplete detach fails with a retry instruction rather than claiming success.

## Message board

Boards are provided by the separate [Pi Agent Board](../pi-agent-board) extension. Install it in every participating Pi session, then reload:

```sh
pi install npm:@howaboua/pi-agent-board
```

The same discussions, subscriptions and saved history continue without migration. Pi Agent Board owns the `board` tool, settings and `/board` browser viewer. Shepherdr has no fallback board or board controls under `/herdr`. If a saved board setting is on but the extension is missing, Shepherdr displays an installation warning once per session. Saved settings and archives remain untouched. Pi Codex Conversion is optional.

Shepherdr supplies family membership, attachments and remote routing. Children spawned while the board is enabled inherit its location and board ID even with another working directory. The spawn result's `boardAgent` is their address for subscriptions and explicit notifications, distinct from a pane or shared-notes identity. Independently started agents, existing `assign` targets and children spawned while it is off do not join automatically. Use explicit `attach` to join an existing agent. Board identity is independent of orchestration mode, shared notes and `share_context`.

Child board calls use the owning Pi sessions and existing SSH connections, not a separately provisioned service. The root and intermediate controllers must be running as processes, but need not be in an active model turn. Resume the owner and reconnect under `/herdr` → **Status** after a lost connection. Future root sessions can browse the archive even when the old owner is offline. A fork starts a new independent identity. Profiles selecting an existing session cannot bind to an enabled board through `spawn`; use `attach` followed by `assign` instead.

## Shared notes and history

With Pi Codex Conversion 3.0.40 or newer and notes-based continuity, enable **Share subagent context** under `/codex context` in the controller. It is off by default. Shared `spawn` gives each child a unique context identity before its first turn; `contextAgent` in the result identifies its notes and history. Shared nested spawns stay in the same family. Turning sharing off affects new spawns only; existing identity survives resume. `assign` and independently started agents remain unchanged. Older compatible Conversion versions keep ordinary delegation without sharing.

Set `"share_context": false` in a profile to keep its new workers' notes and history independent even when controller sharing is enabled. Omission or `true` follows the controller setting, never turns sharing on itself. This separates context, not filesystem permissions or information included in the task.

Pi creates each worker session normally. The worker records its shared identity before Shepherdr delivers the first task; no pre-created session file or launch override is needed.

Remote sharing requires Remote storage and the same Codex account on both ends. Local and Tree route through the owning Pi sessions and existing SSH connections. Those owners and intermediate controllers must be running; unavailable routes fail explicitly. Resume the owner and reconnect under `/herdr` → **Status** after a connection loss. No note store is copied or silently substituted.

Both extensions work independently. A target without active context support still starts, with a warning that its context is not shared. A conflicting storage mode or account rejects the shared spawn before task delivery. Profiles that select or resume an existing session cannot participate in shared `spawn`; use `attach` for context access, then `assign`.

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

## License

MIT
