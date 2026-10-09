# Pi Notes Compaction

Keep working across fresh context windows with local checkpoint notes, searchable session history and optional remote lookup. Works with any Pi model.

This is a private development package, not an npm release.

## Try it

Standalone use needs Pi 1.1.0 or newer. Run an isolated session from this checkout:

```sh
pi --no-extensions -e ./packages/pi-notes-compaction/src/index.ts
```

Ask the agent to save a checkpoint and start a new context window. It can read those notes and search earlier session history to continue.

With Pi Codex Conversion from this checkout, local notes work alongside Codex tools, Code Mode, Notebook and normal compaction. Older PCC versions without this integration leave the extension inactive. Run `/notes status` to check activation and available capabilities. Extension authors can read the [integration contract](PCC-INTEGRATION.md).

## Notes and windows

The agent keeps the familiar `notes`, `history`, `new_context` and `get_context_remaining` tools. Notes use virtual paths. Relative paths belong to the current agent. History searches the selected Pi session branch, including earlier windows. It does not create a second transcript archive.

By default, `new_context` starts a fresh window without generating a summary. The agent receives recent note paths, and Pi's saved history remains available for lookup.

Reminders arrive at 85% and 90% context use. `/compact` requests a notes checkpoint and opens a new window only after a completed run with fresh saved notes. Abort, errors and failed writes retain the old context. Overflow recovery still uses Pi's normal compaction.

After 25 idle minutes, the next input waits for rollover only if the latest completed turn saved fresh notes. Otherwise it proceeds in the current window without requesting a checkpoint. Held input retains its original text, attachments and SDK options. A failed rollover keeps input pending. Submit another prompt to retry, or reload to cancel it.

## Management

- `/notes status` shows activation, storage counts and optional remote capabilities.
- `/notes compact on` runs the installed normal Pi or PCC compaction flow, including on `new_context`.
- `/notes compact off` restores notes-only rollover. This is the default.
- `/notes prune` removes SQLite records for sessions whose recorded files are missing. Unknown paths, permission errors and the active session are retained.

Notes are stored as plaintext in `<Pi agent directory>/notes-compaction/notes.sqlite`, honoring `PI_CODING_AGENT_DIR`. Saved session snapshots preserve notes across forks and branch navigation, including after database pruning. Existing plaintext PCC notes remain readable without an import.

## Optional remote lookup

With the documented provider bridge, reads and searches automatically combine local notes or JSONL history with remote results. Remote response bytes are cached verbatim in SQLite. Cached lookups can be reused offline, with their original coverage and an explicit exact-query limit. Encrypted listings cannot be searched or expanded locally into queries that were never cached.

New writes always stay local and work with any model. `write_file` replaces the local path and takes precedence over a remote read of that path. `append_to_file` adds a local overlay when no local replacement exists. Remote base content and the overlay remain separate. List and search results label local replacements as authoritative because opaque remote results can contain older versions.

Encrypted remote content needs a compatible provider bridge and the user's compatible OpenAI setup. The cache does not decrypt content or make it portable across incompatible setups. Without compatible delivery, local notes remain usable and the result reports that cached remote content is unavailable.
