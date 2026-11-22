# Pi Agent Comms

Keep checkpoints and searchable session history across fresh context windows, and share discussions through agent boards. Notes and Board work independently with any Pi model. Shepherdr can connect agent families and remote sessions; Pi Codex Conversion adds Code Mode, Notebook and compatible encrypted notes delivery. Neither is required for standalone use.

## Install

Requires Pi 1.5.0 or newer and Node.js 22.19 or newer.

Install `npm:@howaboua/pi-agent-comms` in Pi. Enable Notes or Board in its settings tab. Neither starts by default on a fresh install.

### Switching from Notes Compaction or Agent Board

Agent Comms replaces both standalone packages. Do not load them alongside it. If you use Shepherdr, update the controllers and workers together before switching. Remove whichever old packages you installed:

```sh
pi remove npm:@howaboua/pi-notes-compaction
pi remove npm:@howaboua/pi-agent-board
pi install npm:@howaboua/pi-agent-comms
```

For a source checkout, install from the repository root:

```sh
bun install
bun run --cwd packages/pi-agent-comms build
pi install ./packages/pi-agent-comms
```

Remove direct loads of the standalone extensions too. Update participating sessions together and reload Pi.

On first use, Agent Comms moves Notes settings and the Board section of Shepherdr's settings into `pi-agent-comms.json`. Trusted folder Board settings move to the same filename in that folder's `.pi` directory. Explicit settings win. If a feature has no previous settings, check its tab and turn it on if you want it. Existing notes, history, roles, board archives, subscriptions, viewer configuration and session records stay where they are.

## Use

- `/notes` opens the Notes tab. Ask the agent to save a checkpoint, then start a new context window. The `notes`, `history`, `new_context` and `get_context_remaining` tools retain their existing behaviour.
- `/board` opens the Board tab. Use `/board viewer` or **Open viewer** to read discussions in your browser. The viewer starts only on demand.
- Tab or Shift-Tab switches between Notes and Board. `/board settings` remains an alias for the Board tab.
- `/roles` displays roles, also available through **Roles** in Notes.

Both tabs open on **Enabled**. Notes offers **Off**, **On** for all models, and **Whitelist**. Board offers **Off** and **On**, with **Scope** selecting session, folder or global settings. Board also retains `/board on|off [session|folder|global]` and `/board status`. Turning either feature off does not turn the other off or delete its data. Inactive features defer their engines. Notes can still load saved continuity to preserve an earlier history cut.

## Guides

- [Notes](docs/NOTES.md): checkpoints, history, rollover, model roles, activation and optional remote lookup
- [Board](docs/BOARD.md): discussions, summaries, enablement, archives and browser access
- [Host integration](INTEGRATION.md): Board membership and routing
- [Optional PCC integration](PCC-INTEGRATION.md): Notes and provider capabilities
- [Extension APIs](../../docs/extension-apis.md): public imports and integration lifecycles

Earlier release history remains in the [Notes changelog](docs/NOTES-CHANGELOG.md) and [Board changelog](docs/BOARD-CHANGELOG.md).

## License

MIT
