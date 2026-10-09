# Pi Notes Compaction

Keep working across fresh context windows with local checkpoint notes, searchable session history and optional remote lookup. Works with any Pi model.

## Install

Requires Pi 1.1.0 or newer and Node.js 22.18 or newer.

```sh
pi install npm:@howaboua/pi-notes-compaction
```

Reload Pi, then ask the agent to save a checkpoint and start a new context window. It can read those notes and search earlier session history to continue.

With Pi Codex Conversion 3.0.48 or newer, local notes work alongside Codex tools, Code Mode, Notebook and normal compaction. Older PCC versions without this integration leave the extension inactive. Run `/notes` to check activation and available capabilities. Extension authors can read the [integration contract](PCC-INTEGRATION.md).

## Notes and windows

The agent keeps the familiar `notes`, `history`, `new_context` and `get_context_remaining` tools. Notes use virtual paths. Relative paths belong to the current agent. History searches the selected Pi session branch, including earlier windows. It does not create a second transcript archive.

By default, `new_context` starts a fresh window without generating a summary. The agent receives recent note paths, and Pi's saved history remains available for lookup.

Reminders arrive at 85% and 90% context use. `/compact` requests a notes checkpoint and opens a new window only after a completed run with fresh saved notes. Abort, errors and failed writes retain the old context. Overflow recovery still uses Pi's normal compaction.

Idle rollover is off by default. Choose 5, 15, 25 or 55 minutes in `/notes`. After that interval, the next input waits for rollover only if the latest completed turn saved fresh notes. Otherwise it proceeds in the current window without requesting a checkpoint. These intervals are user preferences, not provider cache-expiry guarantees. Held input retains its original text, attachments and SDK options. A failed rollover keeps input pending. Submit another prompt to retry, or reload to cancel it.

## Management

`/notes` opens the settings panel in interactive Pi. It shows continuity status, storage counts and remote capabilities. Changes save immediately.

- **Normal compaction** includes the installed Pi or PCC compaction flow on `new_context`. Off keeps notes-only rollover, the default.
- **Idle rollover** selects the interval or disables it.
- **Prune missing sessions** removes records for missing session files after confirmation. Unknown paths, permission errors and the active session are retained.

Notes are stored as plaintext in `<Pi agent directory>/notes-compaction/notes.sqlite`, honoring `PI_CODING_AGENT_DIR`. Saved session snapshots preserve notes across forks and branch navigation, including after database pruning. Existing plaintext PCC notes remain readable without an import.

## Optional remote lookup

With the documented provider bridge, reads and searches automatically combine local notes or JSONL history with remote results. Remote response bytes are cached verbatim in SQLite. Cached lookups can be reused offline, with their original coverage and an explicit exact-query limit. Encrypted listings cannot be searched or expanded locally into queries that were never cached.

New writes always stay local and work with any model. `write_file` replaces the local path and takes precedence over a remote read of that path. `append_to_file` adds a local overlay when no local replacement exists. Remote base content and the overlay remain separate. List and search results label local replacements as authoritative because opaque remote results can contain older versions.

Encrypted remote content needs a compatible provider bridge and the user's compatible OpenAI setup. The cache does not decrypt content or make it portable across incompatible setups. Without compatible delivery, local notes remain usable and the result reports that cached remote content is unavailable.
