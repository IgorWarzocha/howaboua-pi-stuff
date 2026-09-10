# pi-shepherdr

One persistent agent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr combines a monitored [Herdr](https://herdr.dev) fleet with blocking and asynchronous agent calls. It registers one routed `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous calls return after dispatch, then push completion, failure or blockage into the controller with a steer message. The model never has to poll. Blocking calls hold the tool call and return the worker's reply directly.

With Pi Codex's compatible custom developer-message API active, asynchronous worker reports and orchestration toggles use the Responses developer role while retaining their normal display and session restoration. Without that API or adapter, delivery remains ordinary Pi custom messages. Blocking results stay in the tool response.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

Requires Pi 0.84.4 or newer, Herdr 0.9 or newer and the Herdr Pi integration:

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

Remote machines connect over noninteractive SSH. The target needs `node` on its SSH PATH, Herdr 0.9 or newer, the Herdr Pi integration and a running Herdr session. Shepherdr installs one helper at `~/.pi/agent/shepherdr.mjs` on each remote, runs it only for the connection lifetime and leaves no remote daemon behind. Herdr's multi-machine UI does not expose a cross-machine automation socket, so Shepherdr still owns its remote transport and Pi transcript reads.

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

`spawn`, `assign` and `answer` block by default. Set `blocking: false` when the controller should continue other work immediately. Task completion and blockage are then delivered automatically.

Questions, status updates and replies use `send`. It returns after submission, does not accept `blocking`, and never creates or changes a watch or task. Use `assign` only to delegate work whose result you need, not to exchange coordination messages.

Automatic delegation watches end when the task finishes or fails. Blocked tasks stay watched until resolved. Only an explicit `watch` keeps reporting subsequent work until `unwatch`. Sending an update to your worker preserves its existing task watch without replacing the task.

Reviewer spawns always block, even when `blocking: false` is supplied. The controller waits for the review before continuing work on its scope.

Every `spawn` needs an `agent_type` and a concise two- or three-word `label`. The label names both the Herdr tab and Pi session; the routing `name` remains optional and is derived from it when omitted.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

Prompts sent through `agents` identify peer messages versus delegated tasks and include the sender's host, session, workspace, tab and pane identity, with current names. Reports include source workspace and tab names too. Raw `herdr agent prompt` calls bypass this attribution. These are runtime locations, not the desktop window showing a pane.

Messages sent through `agents` bypass the receiving Pi editor, preserving unsent drafts. Update and reload Shepherdr on receiving agents as well as controllers. If a receiver is unavailable, delivery fails without pasting into its terminal. Raw `herdr agent prompt` still uses terminal input and does not provide this protection.

Messages beginning with `/` use the target Pi session's command, skill and prompt-template expansion, with sender attribution kept out of the arguments. Skills and templates retain normal task waiting. Registered extension commands return `commandSubmitted: true` without waiting or adding a task watch, even through `spawn` or `assign`; submission does not confirm command success. TUI-only commands such as `/model` and `/settings` are not available through this route. When Pi Codex Conversion is installed, update and reload it too.

Idle messages start a prepared user turn. Messages arriving during a run use steering, promoted to developer messages when Pi Codex developer delivery is active. Otherwise they remain ordinary Pi custom messages.

For `answer` inside Code or Notebook Mode, update Pi Ask on workers together with Shepherdr on controllers.

## Profiles

On first load, Shepherdr installs three editable profiles:

- `general` uses `openai-codex/gpt-5.6-sol` with `high` thinking for implementation
- `explorer` uses `openai-codex/gpt-5.6-terra` with `high` thinking for read-only discovery
- `reviewer` uses `openai-codex/gpt-5.6-luna` with `xhigh` thinking for generic read-only review

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

## Advanced Herdr control

Ordinary delegation stays inside `agents`. For workspace, tab, pane, process, focus, layout or raw-terminal operations, run `herdr --skill` and follow the installed Herdr skill. Shepherdr does not duplicate those controls.

Herdr still owns terminals, layout, agent processes and restored sessions. Shepherdr owns event subscriptions, remote routing, the fleet widget and purple settlement messages.

## License

MIT
