# pi-shepherdr2

One persistent subagent system for ordinary Pi, Code Mode and Notebook Mode.

Shepherdr 2 combines Shepherdr's monitored Herdr fleet with the blocking and asynchronous agent calls previously supplied by Pi Codex's custom `agents` tool. It registers one structured `agents` tool in normal Pi. When Pi Codex is installed, the same definition, renderer and implementation become `tools.agents` inside Code and Notebook Mode.

Asynchronous work is still subagent work. The call returns after dispatch, then Shepherdr pushes completion, failure or blockage into the master with a `steer` message. The model never has to poll. Blocking work holds the tool call and returns the worker's reply directly.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr2
```

Requires Pi 0.84.3 or newer, Herdr 0.8.x and the Herdr Pi integration:

```bash
herdr integration install pi
```

Do not load `pi-shepherdr` or Pi Codex's example `agents.toml` custom tool alongside Shepherdr 2. They own overlapping master commands and agent surfaces.

Pi Codex 3.0.24 or newer is optional. Without it, Shepherdr 2 remains a normal Pi extension.

## Enable the master

Run Pi inside Herdr, then enable orchestration for the current session:

```text
/herdr master
```

Use `/herdr json` to persist master mode in the current directory. Machine configuration and the `/herdr` management interface are shared with Shepherdr.

## Agent calls

The `agents` tool supports:

| Action | Result |
| --- | --- |
| `list` | Profiles, machines and matching Pi agents |
| `start` | Start a profiled Pi agent and send its initial task |
| `send` | Send work or a follow-up to an existing agent |
| `read` | Read the latest assistant reply or bounded terminal output |
| `answer` | Answer a worker blocked on Pi Ask |
| `watch` | Push future settlement from an existing Pi agent |
| `unwatch` | Stop reporting an agent |

`start`, `send` and `answer` block by default. Set `blocking: false` only when the master should continue other work immediately. Completion and blockage are then delivered automatically.

Cancelling a blocking call does not kill its worker. The waiter detaches and the eventual result returns through normal asynchronous delivery.

## Profiles

Three profiles work without configuration:

- `general` for implementation and investigation
- `explorer` for read-only discovery
- `reviewer` for read-only review

They inherit the master's current model and thinking level. Add or replace profiles under:

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

## What remains native

Herdr still owns terminals, layout, agent processes and restored sessions. Shepherdr 2 reuses Shepherdr's event subscriptions, remote bridge, fleet widget and purple settlement messages. In Code Mode, only the tool call's physical placement changes: it renders inside the outer `exec` trace while the persistent widget and pushed messages remain normal Pi UI.
