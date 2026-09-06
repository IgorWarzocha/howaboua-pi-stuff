# pi-shepherdr

One persistent agent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr combines a monitored [Herdr](https://herdr.dev) fleet with blocking and asynchronous agent calls. It registers one routed `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous calls return after dispatch, then push completion, failure or blockage into the controller with a steer message. The model never has to poll. Blocking calls hold the tool call and return the worker's reply directly.

With Pi Codex's compatible custom developer-message API active, asynchronous worker reports and orchestration toggles use the Responses developer role while retaining their normal display and session restoration. Without that API or adapter, delivery remains ordinary Pi custom messages. Blocking results stay in the tool response.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

Requires Pi 0.84.3 or newer, Herdr 0.8.x and the Herdr Pi integration:

```bash
herdr integration install pi
```

Do not load Pi Codex's example `agents.toml` custom tool alongside Shepherdr; they own the same agent surface.

Pi Codex 3.0.25 or newer is optional. Without it, Shepherdr remains a normal Pi extension.

## Enable orchestration

The agent tool is always available in Pi, Code Mode and Notebook Mode. Run Pi inside Herdr to connect the fleet and start monitoring automatically. To prioritize orchestration over direct work for the current session:

```text
/herdr
```

The command only records one visible guidance message without triggering a turn. Run `/herdr` again to return to normal guidance. Resumed sessions restore their last mode; new sessions start with normal guidance. Tool availability and monitoring do not depend on this mode.

`/herdr machines` opens the Add/Remove Machine interface. Settings live at `<pi-agent-directory>/shepherdr.json`, where the directory defaults to `~/.pi/agent` and `PI_CODING_AGENT_DIR` overrides it. `/herdr connect [machine]` retries configured remotes after activation.

Remote machines connect over noninteractive SSH. The target needs Node, Herdr 0.8.x, the Herdr Pi integration and a running Herdr session. Shepherdr installs one helper at `~/.pi/agent/shepherdr.mjs` on each remote, runs it only for the connection lifetime and leaves no remote daemon behind.

## Agent calls

Call the `agents` tool with `action: "help"` before first use, then send flat request objects. Code and Notebook Mode expose the same router as `await tools.agents({ action: "help" })`; every call requires `action`.

| Action | Result |
| --- | --- |
| `help` | Live profiles, request shapes, coordination rules and the advanced Herdr escape hatch |
| `list` | Profiles, machines and matching Pi agents |
| `find` | Agents matching a query or status |
| `spawn` | Spawn a profiled Pi agent and send its initial task |
| `send` | Send work or a follow-up to an existing agent |
| `read` | Read the latest assistant reply or bounded terminal output |
| `answer` | Answer a worker blocked on Pi Ask |
| `watch` | Push future settlement from an existing Pi agent |
| `unwatch` | Stop reporting an agent |

`spawn`, `send` and `answer` block by default. Set `blocking: false` only when the controller should continue other work immediately. Completion and blockage are then delivered automatically.

Reviewer spawns always block, even when `blocking: false` is supplied. The controller waits for the review before continuing work on its scope.

Every `spawn` needs an `agent_type` and a concise two- or three-word `label`. The label names both the Herdr tab and Pi session; the routing `name` remains optional and is derived from it when omitted.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

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
