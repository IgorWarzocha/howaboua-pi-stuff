# pi-herdr-agents

Control and monitor Pi coding agents running in [Herdr](https://herdr.dev) from one Pi session.

The extension adds one compact `herdr_agents` tool. Pi sessions start as workers with no model-visible orchestration tool. `/herdr master` enables the tool only for the running Pi session. In a dedicated control directory, `/herdr json` also persists master mode in `.pi/herdr.json`. The tool discovers existing agents, starts Pi in explicitly selected Herdr locations, watches or unwatches agents, and sends follow-ups. It does not move, focus, or close existing panes, and it does not invent a parallel workspace model.

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
