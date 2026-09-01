# pi-shepherdr2

One persistent subagent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr 2 combines Shepherdr's monitored Herdr fleet with the blocking and asynchronous agent calls previously supplied by Pi Codex's custom `agents` tool. It registers one routed `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous work is still subagent work. The call returns after dispatch, then Shepherdr pushes completion, failure or blockage into the controller with a `steer` message. The model never has to poll. Blocking work holds the tool call and returns the worker's reply directly.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr2
```

Requires Pi 0.84.3 or newer, Herdr 0.8.x and the Herdr Pi integration:

```bash
herdr integration install pi
```

Do not load `pi-shepherdr` or Pi Codex's example `agents.toml` custom tool alongside Shepherdr 2. They own overlapping commands and agent surfaces.

Pi Codex 3.0.24 or newer is optional. Without it, Shepherdr 2 remains a normal Pi extension.

## Enable orchestration

Pi sessions remain ordinary workers until explicitly promoted. Run Pi inside Herdr, then activate the agent tool and orchestration guidance for the current session:

```text
/herdr
```

The command records one visible mode message without triggering a turn. Run `/herdr` again to return to normal guidance while keeping the agent tool available. Resumed controller sessions restore their last mode; new worker sessions in the same directory remain dormant.

`/herdr machines` opens the Add/Remove Machine interface. Settings remain in `~/.pi/agent/shepherdr.json`, and `/herdr connect [machine]` retries configured remotes after activation.

## Agent calls

Call the `agents` tool with `action: "help"` before first use, then send flat request objects. Code and Notebook Mode expose the same router as `await tools.agents({ action: "help" })`; every call requires `action`. Neither surface carries the full action schema in its standing prompt.

The routed tool supports:

| Action | Result |
| --- | --- |
| `help` | Live profiles, request shapes, coordination rules and the advanced Herdr escape hatch |
| `list` | Profiles, machines and matching Pi agents |
| `find` | Agents matching a query or status |
| `start` | Start a profiled Pi agent and send its initial task |
| `send` | Send work or a follow-up to an existing agent |
| `read` | Read the latest assistant reply or bounded terminal output |
| `answer` | Answer a worker blocked on Pi Ask |
| `watch` | Push future settlement from an existing Pi agent |
| `unwatch` | Stop reporting an agent |

`start`, `send` and `answer` block by default. Set `blocking: false` only when the controller should continue other work immediately. Completion and blockage are then delivered automatically.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

## Profiles

Two profiles work without configuration:

- `explorer` uses `openai-codex/gpt-5.6-terra` with `high` thinking for read-only discovery
- `reviewer` uses `openai-codex/gpt-5.6-luna` with `xhigh` thinking for generic read-only review

Profiles never inherit the controller's model or thinking level. Add or replace complete profile definitions under:

```text
~/.pi/agent/shepherdr2/profiles/<name>/profile.json
```

Example:

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

`prompt` is read as system-prompt text. An optional `prepare` module may export `prepare({ cwd, message, base })` and return the worker message. Preparation runs on the controlling machine before dispatch.

## Advanced Herdr control

Ordinary delegation stays inside `agents`. For workspace, tab, pane, process, focus, layout or raw-terminal operations, run `herdr --skill` and follow the installed Herdr skill. The `help` response and standing tool guidance both expose that route; Shepherdr 2 does not duplicate those controls.

## What remains native

Herdr still owns terminals, layout, agent processes and restored sessions. Shepherdr 2 reuses Shepherdr's event subscriptions, remote bridge, fleet widget and purple settlement messages. In Code Mode, only the tool call's physical placement changes: it renders inside the outer `exec` trace while the persistent widget and pushed messages remain normal Pi UI.
