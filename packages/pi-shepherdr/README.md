# pi-shepherdr

One persistent agent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr combines a monitored [Herdr](https://herdr.dev) fleet with blocking and asynchronous agent calls. It registers one routed `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous calls return after dispatch, then push completion, failure or blockage into the controller with a steer message. The model never has to poll. Blocking calls hold the tool call and return the worker's reply directly.

With Pi Codex's compatible custom developer-message API active, asynchronous worker reports and orchestration toggles use the Responses developer role while retaining their normal display and session restoration. Without that API or adapter, delivery remains ordinary Pi custom messages. Blocking results stay in the tool response.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

Requires Pi 1.0.0 or newer, Herdr 0.9 or newer and the Herdr Pi integration:

```bash
herdr integration install pi
```

Do not load Pi Codex's example `agents.toml` custom tool alongside Shepherdr; they own the same agent surface.

Pi Codex is optional. Without it, Shepherdr remains a normal Pi extension.

## Enable orchestration

The agent tool is always available in Pi, Code Mode and Notebook Mode. Run Pi inside Herdr to connect the fleet and start monitoring automatically. To prioritize orchestration over direct work for the current session:

```text
/herdr
```

The command only records one visible guidance message without triggering a turn. Run `/herdr` again to return to normal guidance. Resumed sessions restore their last mode; new sessions start with normal guidance. Tool availability and monitoring do not depend on this mode.

Shepherdr reads Herdr's existing machine profiles and connects enabled profiles at session startup. Manage profiles in Herdr. `/herdr connect [profile-id]` refreshes the catalog and retries failed connections or incomplete monitoring without dropping working connections. A catalog refresh stops watches for disabled or removed profiles without stopping remote agents.

Profiles belong to the host running Pi, not the machine displaying its terminal. Omit `machine` for local agent calls. `list` and `find` search all machines unless filtered. Explicit `local` also means the host running Pi. For remote calls, use the opaque profile ID returned by `list`, not its label or hostname. Renaming a profile changes its label, not its routing identity.

Remote machines connect over noninteractive SSH. The target needs `node` on its SSH PATH, Herdr 0.9 or newer, the Herdr Pi integration and a running Herdr session. Shepherdr installs managed transport helpers under `~/.pi/agent` on each remote, runs them only for the connection lifetime and leaves no remote daemon behind. Herdr's multi-machine UI does not expose a cross-machine automation socket, so Shepherdr still owns its remote transport and Pi transcript reads.

### Migrating from separate Shepherdr machines

`shepherdr.json` is no longer read. Existing Herdr profiles are used directly. Configure any missing profiles in Herdr on the host running Pi. Old machine aliases are not migrated. Legacy watches, including local watches, are cleared with a notice because they cannot distinguish explicit subscriptions from accidental ones. Re-select any ongoing watches explicitly.

## Agent calls

Call the `agents` tool with `action: "help"` before first use, then send flat request objects. Code and Notebook Mode expose the same router as `await tools.agents({ action: "help" })`; every call requires `action`.

| Action | Result |
| --- | --- |
| `help` | Live profiles, request shapes, coordination rules and the advanced Herdr escape hatch |
| `list` | Profiles, machines and matching Pi agents |
| `find` | Agents matching a query or status |
| `spawn` | Spawn a profiled Pi agent and send its initial task |
| `send` | Send a peer message without waiting or subscribing |
| `assign` | Delegate a task to an existing agent |
| `read` | Read the latest assistant reply or bounded terminal output |
| `answer` | Answer a worker blocked on Pi Ask |
| `watch` | Push future settlement from an existing Pi agent |
| `unwatch` | Stop reporting an agent |

`spawn` and `assign` block by default. Set `blocking: false` when the controller should continue other work immediately. A profile's `blocking` setting overrides the call for `spawn`. Task completion and blockage are then delivered automatically.

`answer` requires the pending `ask_id` from `read` or a blocked report. It returns `accepted` only when that exact Ask persisted the supplied responses; an accepted retry sends no input.

Questions, status updates and replies use `send`. It returns after submission, does not accept `blocking`, and never creates or changes a watch or task. Use `assign` only to delegate work whose result you need, not to exchange coordination messages.

Automatic delegation watches end when the task finishes or fails. Blocked tasks stay watched until resolved. Only an explicit `watch` keeps reporting subsequent work until `unwatch`. Sending an update to your worker preserves its existing task watch without replacing the task.

Every `spawn` needs an `agent_type` and a concise two- or three-word `label`. The label names both the Herdr tab and Pi session; the routing `name` remains optional and is derived from it when omitted.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

Prompts sent through `agents` identify peer messages versus delegated tasks and include the sender's host, session, workspace, tab and pane identity, with current names. Reports include source workspace and tab names too. Raw `herdr agent prompt` calls bypass this attribution. These are runtime locations, not the desktop window showing a pane.

Messages sent through `agents` bypass the receiving Pi editor, preserving unsent drafts. Update and reload Shepherdr on receiving agents as well as controllers. If a receiver is unavailable, delivery fails without pasting into its terminal. Raw `herdr agent prompt` still uses terminal input and does not provide this protection.

Messages beginning with `/` use the target Pi session's command, skill and prompt-template expansion, with sender attribution kept out of the arguments. Skills and templates retain normal task waiting. Registered extension commands return `commandSubmitted: true` without waiting or adding a task watch, even through `spawn` or `assign`; submission does not confirm command success. TUI-only commands such as `/model` and `/settings` are not available through this route. When Pi Codex Conversion is installed, update and reload it too.

Idle messages start a prepared user turn. Messages arriving during a run use steering, promoted to developer messages when Pi Codex developer delivery is active. Otherwise they remain ordinary Pi custom messages.

For `answer` inside Code or Notebook Mode, update Pi Ask on workers together with Shepherdr on controllers.

## Message board

The board is off by default. In the root session, run `/herdr board` to open its settings menu. Choose a session override, a remembered folder default, or **Enable globally**. Disabling the board hides its tool and stops notifications without deleting history. Board storage requires Node.js 22.13 or newer. Pi Codex Conversion is not required.

Session overrides survive resume but do not carry into new root sessions or forks. Folder settings apply only to sessions launched in that exact folder, not its child directories. Global enablement is a separate setting. Precedence is session, folder, then global. Bound children inherit their root's choice even with a different working directory. Orchestration mode and shared notes remain independent.

The menu saves folder settings in `<launch-folder>/.pi/pi-shepherdr.json`:

```json
{ "board": { "enabled": true } }
```

The extension creates `pi-shepherdr.json` in Pi's global agent directory with this default:

```json
{ "board": { "enabledGlobally": false } }
```

The agent directory defaults to `~/.pi/agent` and respects `PI_CODING_AGENT_DIR`. Enabling a board in the home folder writes `~/.pi/pi-shepherdr.json`, not the global setting. It does not enable boards in other folders. Storage location never implies activation scope. JSON edits are picked up before the next user turn or on `/reload`; invalid configuration disables the board with an explicit error.

Command equivalents are `/herdr board on` or `off` for this session, `/herdr board on folder` or `off folder` for a folder default, and `/herdr board on global` or `off global` for the global default. `/herdr board inherit` clears the session override; `/herdr board inherit folder` clears the folder override. A session override can mask changes to either default. Outside the TUI, `/herdr board` reports status and archive location.

Agents call `board` with `action: "help"` to discover channels, posts, replies, search, subscriptions and bounded reads. Code and Notebook Mode use `tools.board`. Agents choose when discussions are useful. Enabling the board, starting sessions, reading history and spawning children do not create an empty board. The first successful channel creation or post to a new channel creates it.

Results fit 8,000 serialized UTF-8 bytes, including JSON escaping and metadata. Reads may return smaller pages or text slices than requested. Continue with the returned cursor or `next_offset_chars`. A search with `after_message_id` requires a post in the selected board, even before an archive exists.

One archive at `<owning-folder>/.pi/agent-message-board.sqlite` retains all boards for that folder. Each root Pi session has an isolated board; resume keeps it and new root sessions get separate boards. Children spawned while the board is enabled inherit its location and board ID even with another working directory. The spawn result's `boardAgent` is their address for subscriptions and explicit notifications, distinct from a pane or shared-notes identity. Independently started agents, existing `assign` targets and children spawned while it is off do not join automatically. Board identity is independent of shared notes and `share_context`.

Calls default to the current board. `list_boards` lists saved boards, and `board_id` on read and search actions browses their history. Writes and subscriptions always target the current board. There is no task assignment, post editing or board deletion tool. These archives contain discussion text; keep them out of version control and do not share them with users who should not read that text.

Posting subscribes its author to discussion replies unless the author explicitly unsubscribed. Channel subscriptions concern only new first posts. Explicit notification targets receive a one-time preview without subscribing. Notifications reach running turns only: no waking idle agents and no queued offline notices. Full text remains available through reads.

Child board calls use the owning Pi sessions and existing SSH connections, not a separately provisioned service. The root and intermediate controllers must be running as processes, but need not be in an active model turn. Resume the owner and use `/herdr connect` after a lost connection. Future root sessions can browse the archive even when the old owner is offline. A fork starts a new independent identity. Profiles selecting an existing session cannot bind to an enabled board through `spawn`; use `assign` without board membership instead.

## Shared notes and history

With Pi Codex Conversion 3.0.40 or newer and notes-based continuity, enable **Share subagent context** under `/codex context` in the controller. It is off by default. Shared `spawn` gives each child a unique context identity before its first turn; `contextAgent` in the result identifies its notes and history. Shared nested spawns stay in the same family. Turning sharing off affects new spawns only; existing identity survives resume. `assign` and independently started agents remain unchanged. Older compatible Conversion versions keep ordinary delegation without sharing.

Set `"share_context": false` in a profile to keep its new workers' notes and history independent even when controller sharing is enabled. Omission or `true` follows the controller setting, never turns sharing on itself. This separates context, not filesystem permissions or information included in the task.

Pi creates each worker session normally. The worker records its shared identity before Shepherdr delivers the first task; no pre-created session file or launch override is needed.

Remote sharing requires Remote storage and the same Codex account on both ends. Local and Tree route through the owning Pi sessions and existing SSH connections. Those owners and intermediate controllers must be running; unavailable routes fail explicitly. Resume the owner and use `/herdr connect` after a connection loss. No note store is copied or silently substituted.

Both extensions work independently. A target without active context support still starts, with a warning that its context is not shared. A conflicting storage mode or account rejects the shared spawn before task delivery. Profiles that select or resume an existing session cannot participate in shared `spawn`; use `assign` instead.

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
