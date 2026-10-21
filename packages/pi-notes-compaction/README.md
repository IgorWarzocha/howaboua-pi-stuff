# Pi Notes Compaction

Keep working across fresh context windows with local checkpoint notes, searchable session history and optional remote lookup. Works with any Pi model.

## Install

Requires Pi 1.2.0 or newer and Node.js 22.18 or newer.

```sh
pi install npm:@howaboua/pi-notes-compaction
```

Reload Pi, then ask the agent to save a checkpoint and start a new context window. It can read those notes and search earlier session history to continue.

With Pi Codex Conversion 3.0.48 or newer, local notes work alongside Codex tools, Code Mode, Notebook and normal compaction. Older PCC versions without this integration leave the extension inactive. Run `/notes` to check activation and available capabilities. Extension authors can read the [integration contract](PCC-INTEGRATION.md).

## Notes and windows

The agent keeps the familiar `notes`, `history`, `new_context` and `get_context_remaining` tools. Notes use virtual paths. Relative paths belong to the current agent. History searches the selected Pi session branch, including earlier windows. It does not create a second transcript archive.

Previously shared local notes and history remain readable after the other agent closes or Shepherdr is removed. Notes follows the saved family relationships and attachment aliases without requiring PCC. Reads use the other session's saved branch and preserve its history IDs. When only a retained attachment snapshot is available, notes identify it as detached or potentially stale. Snapshots do not contain history. Cross-agent writes still require their live routing service. Saved history reads do not fetch or decrypt remote history.

By default, `new_context` starts a fresh window without generating a summary. The agent receives recent note paths, and Pi's saved history remains available for lookup.

The tool requires a successful checkpoint write immediately before the request. Direct `notes` writes and writes completed through `exec` or `wait` count. A missing, pending or failed write keeps the current run active and asks the agent to save a note first.

Reminders arrive at 85% and 90% context use. With normal compaction off, `/compact` opens a fresh window immediately if the latest completed turn saved fresh notes. Otherwise it requests a checkpoint first. The new window waits for your next prompt; it does not start a continuation turn. Abort, errors and failed writes retain the old context. Overflow recovery still uses Pi's normal compaction.

Pi rejects `/compact` when there is too little history to prepare compaction, before extensions run. `new_context` follows the separate **New window requests** setting.

Idle rollover is off by default. Choose 25m, 55m, 2h, 6h or 12h in `/notes`. Hour presets use a five-minute buffer, stored as 115, 355 or 715 minutes. Saved 5- and 15-minute settings remain valid. After the interval, the next input waits for rollover only if the latest completed turn saved fresh notes. Otherwise it proceeds in the current window without requesting a checkpoint. These intervals are user preferences, not provider cache-expiry guarantees. Held input retains its original text, attachments and SDK options. If normal compaction has nothing to summarise, input proceeds in the current window. A failed rollover keeps input pending. Submit another prompt to retry, or reload to cancel it.

## Management

`/notes` opens the settings panel in interactive Pi. It shows continuity status, storage counts and remote capabilities. Changes save immediately.

- **Active** selects **All models** (the default) or **Whitelist**. Whitelist enables the extension only for exact model IDs in the global settings file, regardless of provider. Switching models applies the choice immediately; other models keep their installed compaction behaviour.
- **Normal compaction** uses the installed Pi or PCC compaction flow for `/compact` and `new_context`. Off keeps notes-only rollover, the default.
- **New window requests** controls the agent's `new_context` tool independently of the compaction method. **off** disables the tool. **pi-limits** uses Pi's eligibility check and continues in the current window when there is too little history. **unrestricted**, the default, accepts requests at any size. With normal compaction on and nothing to summarise, unrestricted requests open a new window identity without discarding the existing context. Manual `/compact` and idle rollover retain their separate policies.
- **Idle rollover** selects the interval or disables it.
- **Prune missing sessions** removes records for missing session files after confirmation. Unknown paths, permission errors and the active session are retained.

Notes are stored as plaintext in `<Pi agent directory>/notes-compaction/notes.sqlite`, honoring `PI_CODING_AGENT_DIR`. Saved session snapshots preserve notes across forks and branch navigation, including after database pruning. Existing plaintext PCC notes remain readable without an import.

The whitelist is preseeded in `<Pi agent directory>/notes-compaction/settings.json` (normally `~/.pi/agent/notes-compaction/settings.json`):

```json
{
  "active": "whitelist",
  "modelWhitelist": ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol"],
  "normalCompaction": false,
  "newWindowRequests": "unrestricted",
  "idleMinutes": 0,
  "taskBoundaryReminder": 0
}
```

Add or remove model IDs and reload Pi. Copy the model's exact ID, without Pi's provider selector prefix. If the ID itself contains slashes, keep them. Entries are literal matches, not patterns. A new model is inactive in Whitelist mode until you add its ID.

## Optional remote lookup

With the documented provider bridge, reads and searches automatically combine local notes or JSONL history with remote results. Remote response bytes are cached verbatim in SQLite. Cached lookups can be reused offline, with their original coverage and an explicit exact-query limit. Encrypted listings cannot be searched or expanded locally into queries that were never cached.

New writes always stay local and work with any model. `write_file` replaces the local path and takes precedence over a remote read of that path. `append_to_file` adds a local overlay when no local replacement exists. Remote base content and the overlay remain separate. List and search results label local replacements as authoritative because opaque remote results can contain older versions.

Encrypted remote content needs a compatible provider bridge and the user's compatible OpenAI setup. The cache does not decrypt content or make it portable across incompatible setups. Without compatible delivery, local notes remain usable and the result reports that cached remote content is unavailable.
