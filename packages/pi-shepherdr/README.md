# pi-shepherdr

Talk to one Pi. Let it run the others.

Shepherdr turns one Pi session into an orchestrator for Pi agents running across [Herdr](https://herdr.dev). Give work to the master; it can find existing agents, start new ones in explicit locations, send follow-ups and bring their full replies back into the same conversation.

This is particularly handy with realtime voice. You keep talking to one agent while the workers operate in their panes and project directories. Finished work comes back automatically. If a worker needs approval or an answer, the master is steered at the next opportunity instead of leaving you to hunt through panes.

Herdr still owns the terminals, layout and restored sessions. Shepherdr connects them to one Pi conversation.

## Install

```bash
pi install npm:@howaboua/pi-shepherdr
```

Requires Pi 0.84.1 or newer and the Herdr Pi integration:

```bash
herdr integration install pi
```

Shepherdr supports Herdr 0.8.x. It was developed and validated with 0.8.0; Herdr 0.7.x and older are unsupported. The controlling Pi session must run inside Herdr.

## Set up the master

Pi sessions remain ordinary workers by default. They receive no orchestration tool or master instructions.

To try master mode in the current session:

```text
/herdr master
```

For a lasting setup, open Pi in a dedicated control directory and run:

```text
/herdr json
```

That command atomically merges the following setting into `.pi/herdr.json`:

```json
{
  "master": true
}
```

Future Pi sessions in that directory start as masters. `/herdr master` affects only the current session.

While master mode is active, Pi is guided to delegate project implementation and synthesize the results. It works directly when you explicitly ask, and for configuration, documentation and routine operations in its current directory.

## What the master can do

Shepherdr adds one compact `herdr_agents` tool:

| Action | What it does |
| --- | --- |
| `list` | Find Pi agents and Herdr workspaces. |
| `start` | Launch a named Pi agent in an explicitly selected new workspace, new tab or existing pane. An optional prompt starts work immediately. |
| `watch` | Subscribe to an existing Pi agent. |
| `send` | Send a follow-up to any Pi agent and monitor it automatically. |
| `unwatch` | Stop reporting an agent without stopping or moving it. |

Delegation is fire-and-forget. A `start` with an initial prompt, plus every `watch` and `send`, tells the master not to poll. Completion or blockage arrives automatically.

Shepherdr does not invent another workspace model or resume mechanism. It never silently moves, focuses, releases or closes existing panes. Herdr remains responsible for detach, reattach, layout restoration and native Pi session restoration.

## Results and blocked workers

A live widget shows the watched agents and their state. When work settles, the master receives a labelled purple message containing the original task and the full, untruncated worker response.

Finished and blocked events both use Pi steering:

- During an active turn, `deliverAs: "steer"` delivers the event after the current tool-call batch and before the next model call.
- While idle, the same steering delivery uses `triggerTurn: true` to start a response immediately.

Shepherdr never uses `followUp` delivery for worker events.

A blocked event includes the pane ID and concrete Herdr commands for inspecting and operating it:

```bash
herdr agent read <pane> --source visible
herdr agent prompt <pane> "<text>"
herdr agent send-keys <pane> <keys>
```

## License

MIT
