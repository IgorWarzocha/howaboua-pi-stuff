# pi-herdr-agents

Control and monitor Pi coding agents running in [Herdr](https://herdr.dev) from one Pi session.

The extension adds one compact `herdr_agents` tool. It discovers existing agents, starts Pi in Herdr-created locations, adopts agents for monitoring, sends follow-ups, reads their latest structured replies, focuses them, and releases or closes them. It does not move existing panes or invent a parallel workspace model.

Monitored agents report through Herdr's lifecycle event stream. When one finishes or blocks, its latest Pi response is injected into the controlling session as a labelled custom message. Idle masters react immediately; busy masters receive it as a queued follow-up.

## Requirements

- Pi 0.84.1 or newer
- Herdr 0.8.0 or newer
- the current Herdr Pi integration: `herdr integration install pi`
- run the controlling Pi session inside Herdr

## Install

```bash
pi install npm:@howaboua/pi-herdr-agents
```

Herdr already owns detach, reattach, server restore, and native Pi session restoration. This extension discovers restored agents and continues prompting them; it does not add a separate resume mechanism.
