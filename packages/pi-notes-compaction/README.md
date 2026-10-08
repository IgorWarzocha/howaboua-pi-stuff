# Pi Notes Compaction

Local checkpoint notes and notes-guided context windows for any Pi model. This is a private development package, not an npm release.

Standalone use needs Pi 1.1.0 or newer. Run an isolated session from this checkout:

```sh
pi --no-extensions -e ./packages/pi-notes-compaction/src/index.ts
```

Current Pi Codex Conversion does not implement the required takeover bridge. If its existing context tools are installed alongside this extension, this extension stays inactive rather than overwriting them. `/notes status` reports the conflict. The proposed integration is specified in [PCC-INTEGRATION.md](PCC-INTEGRATION.md).

## Notes and windows

The agent keeps the familiar `notes`, `history`, `new_context` and `get_context_remaining` tools. Notes use virtual paths. Relative paths belong to the current agent. History searches the selected Pi session branch, including earlier windows. It does not create a second transcript archive.

By default, `new_context` retires the preceding conversation from the next model request without generating a summary. Pi's JSONL history stays intact. The successor runs the full extension preparation chain, with recent note paths and the same context-window identity lineage.

Reminders arrive at 85% and 90% context use. `/compact` requests a notes checkpoint and opens a new window only after a completed run with fresh saved notes. Abort, errors and failed writes retain the old context. Overflow recovery still uses Pi's normal compaction.

After 25 idle minutes, the next input waits for rollover only if the latest completed turn saved fresh notes. Otherwise it proceeds in the current window without requesting a checkpoint. Held input retains its original text, attachments and SDK options. A failed rollover keeps input pending. Submit another prompt to retry, or reload to cancel it.

## Management

- `/notes status` shows activation, storage counts and optional remote capabilities.
- `/notes compact on` runs the installed normal Pi or PCC compaction flow, including on `new_context`.
- `/notes compact off` restores notes-only rollover. This is the default.
- `/notes prune` removes SQLite records for sessions whose recorded files are missing. Unknown paths, permission errors and the active session are retained.

The only compaction setting is the normal-compaction toggle. This extension neither implements a separate compaction engine nor stores compaction output. Ordinary Pi compaction records remain Pi's responsibility.

One SQLite database lives at `<Pi agent directory>/notes-compaction/notes.sqlite`, honoring `PI_CODING_AGENT_DIR`. Session records appear only on an actual note write or remote response cache write. Notes are plaintext. Successful-write recovery snapshots in model-invisible Pi entries preserve native fork and branch behavior even after a source session's SQLite records are pruned. Existing plaintext PCC note entries can be read without importing or rewriting the session.

## Optional remote lookup

With the documented provider bridge, reads and searches automatically combine local notes or JSONL history with remote results. Remote response bytes are cached verbatim in SQLite. Cached lookups can be reused offline, with their original coverage and an explicit exact-query limit. Encrypted listings cannot be searched or expanded locally into queries that were never cached.

New writes always stay local and work with any model. `write_file` replaces the local path and takes precedence over a remote read of that path. `append_to_file` adds a local overlay when no local replacement exists. Remote base content and the overlay remain separate. List and search results label local replacements as authoritative because opaque remote results can contain older versions.

Encrypted remote content needs a compatible provider bridge and the user's compatible OpenAI setup. The cache does not decrypt content or make it portable across incompatible setups. Without compatible delivery, local notes remain usable and the result reports that cached remote content is unavailable.
