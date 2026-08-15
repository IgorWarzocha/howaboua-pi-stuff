# pi-shepherdr

Talk to one Pi. Let it run the others.

Shepherdr turns one Pi session into an orchestrator for Pi agents running across [Herdr](https://herdr.dev). Give work to the master; it can find existing agents, start new ones in explicit locations, send follow-ups and bring their full replies back into the same conversation.

The master gets one small JSON-schema tool with the actions and arguments it needs. Its complete active surface measures 290 `o200k` tokens: 247 for the OpenAI Responses tool declaration and 43 for the master guideline. Workers load none of it.

Enable master mode and Pi already knows its job. You do not have to explain Herdr, ask it to load an orchestration skill or remind it to delegate. The schema handles ordinary delegation without `--help` or improvised CLI commands. Herdr and Shepherdr should be enough on their own; any other Pi extensions and skills continue to work alongside them.

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

That command atomically merges the following setting into `.pi/shepherdr.json`:

```json
{
  "master": true
}
```

Future Pi sessions in that directory start as masters. `/herdr master` affects only the current session.

While master mode is active, Pi is guided to delegate project implementation and synthesize the results. It works directly when you explicitly ask, and for configuration, documentation and routine operations in its current directory.

## Connect more machines

Run `/herdr` and choose **Add machine**. Give the machine a name and an SSH target that already connects noninteractively; the remote machine needs Node, Herdr and the Pi integration. Machine settings live in `~/.pi/agent/shepherdr.json`.

Master mode connects every configured machine once in parallel. A failed or dropped connection remains unavailable without retrying automatically; use `/herdr connect` or `/herdr connect <machine>` to try again.

Shepherdr maintains one remote helper at `~/.pi/agent/shepherdr.mjs`. It updates that file atomically when needed, runs it only for the lifetime of the SSH connection and leaves no remote daemon behind. Agent lists, workspaces, monitored state and full replies retain their machine identity. Ask the master naturally—for example, “run this on desktop”—and it routes the existing `herdr_agents` tool with the configured machine name.

## What the master can do

Shepherdr adds one compact `herdr_agents` tool. Its schema is the complete model-facing control surface:

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

Finished, failed and blocked events all steer the master. During an active turn, the event arrives after the current tool calls and before the next model response. While idle, it starts a response immediately.

A blocked event includes the pane ID and concrete Herdr commands for inspecting and operating it:

```bash
herdr agent read <pane> --source visible
herdr agent prompt <pane> "<text>"
herdr agent send-keys <pane> <keys>
```

## License

MIT
