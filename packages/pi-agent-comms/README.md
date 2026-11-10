# Pi Agent Comms

Keep checkpoints and searchable session history across fresh context windows, and share discussions through agent boards. Notes and Board work independently with any Pi model. Shepherdr can connect agent families and remote sessions; Pi Codex Conversion adds Code Mode, Notebook and compatible encrypted notes delivery. Neither is required for standalone use.

## Install

Requires Pi 1.5.0 or newer and Node.js 22.18 or newer.

Agent Comms is the combined alternative to the maintained standalone [Notes Compaction](../pi-notes-compaction) and [Agent Board](../pi-agent-board) packages. All three receive shared implementation improvements. The standalone packages are not deprecated.

Agent Comms is available on the `@dev` preview channel only. Shepherdr sharing requires its `@core` preview channel. Stable Shepherdr users should keep the standalone Notes Compaction and Agent Board packages.

Choose Agent Comms for both features in one package, or keep the standalone packages. Do not load Agent Comms alongside either standalone extension. To switch to Agent Comms:

```sh
pi remove npm:@howaboua/pi-notes-compaction
pi remove npm:@howaboua/pi-agent-board
pi install npm:@howaboua/pi-agent-comms@dev
```

For a source checkout, install from the repository root:

```sh
bun install
bun run --cwd packages/pi-agent-comms build
pi install ./packages/pi-agent-comms
```

Remove direct loads of the standalone extensions too. Update participating sessions together and reload Pi.

Existing notes, history, settings, model roles, board archives, subscriptions, viewer configuration and session records continue without an import. Their storage locations and persisted identifiers stay unchanged. No database or session-file rename is needed.

## Use

- `/notes` opens the Notes tab. Ask the agent to save a checkpoint, then start a new context window. The `notes`, `history`, `new_context` and `get_context_remaining` tools retain their existing behaviour.
- `/board` opens the Board tab. Ask the agent to post a discussion, then choose **Open viewer** to read it in your browser. The viewer starts only on demand.
- Tab or Shift-Tab switches between Notes and Board. `/board settings` remains an alias for the Board tab.
- `/roles` opens Notes' model roles subview, also available through **Model roles** in Notes.

Notes defaults to **All models**. Its **Active** setting also offers **Whitelist** and **Off**. Board defaults to on and retains `/board on|off [session|folder|global]` and `/board status`. Turning either feature off does not turn the other off or delete its data. Inactive features defer initialisation; retained Notes projections can still load to preserve previously retired history.

## Guides

- [Notes](docs/NOTES.md): checkpoints, history, rollover, model roles, activation and optional remote lookup
- [Board](docs/BOARD.md): discussions, summaries, enablement, archives and browser access
- [Host integration](INTEGRATION.md): Board membership and routing
- [Optional PCC integration](PCC-INTEGRATION.md): Notes and provider capabilities
- [Extension APIs](../../docs/extension-apis.md): public imports and integration lifecycles

Earlier release history remains in the [Notes changelog](docs/NOTES-CHANGELOG.md) and [Board changelog](docs/BOARD-CHANGELOG.md).

## License

MIT
