# pi-shepherdr

Run one Pi session as a Herdr-native orchestrator for other Pi coding agents.

Shepherdr adds one compact `herdr_agents` tool for discovering, starting, watching, and messaging Pi agents in [Herdr](https://herdr.dev). Ordinary Pi sessions remain workers with no model-visible orchestration tool. A master receives full worker results and blocked-state alerts through Herdr's lifecycle event stream instead of polling.

## Requirements

- Pi 0.84.1 or newer
- Herdr 0.8.x; developed and validated with 0.8.0 (0.7.x and older are unsupported)
- the Herdr Pi integration: `herdr integration install pi`
- a controlling Pi session running inside Herdr

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

## Enable a master

Enable orchestration only for the current Pi session:

```text
/herdr master
```

Persist master mode for every Pi session started in the current directory:

```text
/herdr json
```

The persistent command atomically merges this setting into `.pi/herdr.json`:

```json
{
  "master": true
}
```

`/herdr master` writes nothing. A dedicated control directory keeps the master role separate from project workers, but Shepherdr does not create or own that directory. While master mode is active, Pi is guided to delegate project implementation and synthesize results; it works directly only when explicitly asked or for configuration, documentation, and routine operations in its current directory.

## Delegate work

The model-facing tool supports five actions:

- `list` discovers current Herdr workspaces and Pi agents
- `start` launches a named Pi agent in an explicitly selected new workspace, new tab, or existing pane; an optional prompt starts work immediately
- `watch` subscribes to an existing Pi agent
- `send` follows up with any Pi agent and begins monitoring automatically
- `unwatch` stops reporting an agent without stopping, moving, or closing it

Delegation is fire-and-forget. A `start` with an initial prompt, plus every `watch` and `send`, tells the master not to poll; completion or blockage arrives automatically. Shepherdr composes Herdr's existing layout and agent primitives rather than introducing workspaces, resume behavior, or process lifecycle of its own. Herdr remains responsible for detach, reattach, layout restoration, and native Pi session restoration.

## Receive results

A live widget shows watched agents and their state. When work settles, the master receives a labelled purple message containing the original task and the full, untruncated worker response.

- Finished: an idle master receives `triggerTurn: true`; an active master receives `deliverAs: "followUp"`.
- Blocked: an active master receives `deliverAs: "steer"`; an idle master receives `triggerTurn: true` with `deliverAs: "steer"`.

Blocked events include the pane ID and these concrete Herdr operations:

```bash
herdr agent read <pane> --source visible
herdr agent prompt <pane> "<text>"
herdr agent send-keys <pane> <keys>
```

Shepherdr never silently moves, focuses, releases, or closes existing panes.
