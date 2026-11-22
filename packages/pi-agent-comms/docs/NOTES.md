# Notes

Keep working across fresh context windows with local checkpoint notes, searchable session history and optional remote notes lookup. Works with any Pi model.

Part of [Pi Agent Comms](../README.md).

## Install

Requires Pi 1.5.0 or newer and Node.js 22.19 or newer. See the [installation choices and replacement steps](../README.md#install).

```sh
pi install npm:@howaboua/pi-agent-comms
```

Reload Pi, then ask the agent to save a checkpoint and start a new context window. It can read those notes and search earlier session history to continue.

Pi Codex Conversion is optional. Compatible releases add Code Mode, Notebook and encrypted remote delivery without taking over Notes tools or policy. Run `/notes` to check activation and available capabilities. Extension authors can read the [integration contract](../PCC-INTEGRATION.md).

## Notes and windows

The agent keeps the familiar `notes`, `history`, `new_context` and `get_context_remaining` tools. Notes use virtual paths. Relative paths belong to the current agent. History searches the selected Pi session branch, including earlier windows. It does not create a second transcript archive.

History uses case-sensitive substring search by default. Turn on **Ranked history search** in `/notes` to search earlier context in the current session with BM25. Ranked search matches all query words, ignoring case, accents and word order. Set `recent_first: true` to put the newest matches first. Arguments and result IDs are unchanged. Notes search remains a case-sensitive substring search.

Ranked search is off by default. It indexes user messages and visible assistant replies left behind by rollover or compaction. Ongoing context, tool calls, tool outputs and internal reasoning stay unindexed. Indexing runs off the UI thread and processes newly eligible entries without repeatedly hashing unchanged history. The first search may wait for indexing to finish. It does not scan other saved sessions. The SQLite index stores terms rather than another transcript. Branch and window filters still control which entries can be returned. JSONL remains the source of truth.

Explicit searches of tool history, a window containing live context or another agent's history use literal substring matching. Search results identify the matching mode. Listing and reading history still includes the full transcript, including ongoing context and tool activity.

Previously shared local notes and history remain readable from accessible saved sessions after the other agent closes or Shepherdr is removed. Notes follows saved family relationships and attachment aliases without requiring PCC or a live parent. Reads use the other session's selected branch and preserve its history IDs. When only a retained attachment snapshot is available, notes identify it as detached or potentially stale. Snapshots do not contain history. Cross-agent writes still require live routing.

With Shepherdr, live sharing and cross-machine saved-session reads require its coordinated Agent Comms update in all participating sessions. Older Shepherdr releases import the former Notes package and must be updated before removing it. Saved reads require access to the saved Pi JSONL session, locally or through the host's saved-session transport. Saved reads do not replace hybrid lookup or its encrypted cache with local-only results. History uses Pi JSONL, never remote notes or cached responses.

In Code Mode and Notebook, plaintext notes and history return ordinary JavaScript values. Encrypted notes return delivery receipts instead of exposing their contents to JavaScript.

By default, `new_context` starts a fresh window without generating a summary. The agent receives recent note paths, and Pi's saved history remains available for lookup.

Turn on **Task-completion rollover** in `/notes` to let the agent call `new_context({resume: false})` when its task is complete. It finishes its reply, then opens a fresh window without starting another turn. The next input starts work in that window. This option is off by default. Omitting `resume`, or setting it to `true`, continues immediately as before.

The tool requires a successful checkpoint write immediately before the request. Direct `notes` writes and writes completed through `exec` or `wait` count. A missing, pending or failed write keeps the current run active and asks the agent to save a note first.

Code and Notebook also accept `await tools.new_context(...)` after an awaited note save in the same cell. The native tool remains the advertised entry point. The nested callable does not add prompt guidance or a discovery listing.

Reminders arrive at 85% and 90% context use. With normal compaction off, `/compact` opens a Notes window. If there is no eligible save, it asks the agent to save a checkpoint first. Instructions after `/compact` guide that checkpoint. The new window waits for your next prompt. Overflow recovery still uses Pi's normal compaction.

Set **Rollover tail** to **Conversation** to keep user messages, attachments and assistant replies since the last completed Notes save on the selected branch in this window. **Full** also keeps complete tool-call groups, reasoning and extension messages. The carried conversation stays in its original order. It does not start another turn. With **Off** (the default), no tail is carried and only a save in the latest completed turn qualifies.

Pi rejects `/compact` when there is too little history to prepare compaction, before extensions run. `new_context` follows the separate **New window requests** setting.

Idle rollover is off by default. Choose 25m, 55m, 2h, 6h or 12h in `/notes`. Hour presets leave a five-minute buffer. When the interval elapses, the next prompt waits for rollover. With a Conversation or Full tail, Notes uses the same save eligibility as `/compact` and requests a checkpoint if needed. With the tail off or normal compaction on, input proceeds in the current window if the latest completed turn did not save notes.

Held input keeps its original text, attachments and SDK options. If normal compaction has nothing to summarise, input proceeds in the current window. After a failed checkpoint or rollover, submit another prompt to retry or reload to cancel the pending input.

## Management

### Session pruning

Open **Session auto-pruning** in `/notes` to set this session's retention limits. **Run now** previews and confirms irreversible removal of retired payloads. Automatic pruning runs after a new window's first completed turn. Saved SQLite notes and current context remain intact. Settings follow the session on resume. New and forked sessions start with pruning off.

Live pruning keeps every history entry ID so Pi can still navigate its in-memory tree safely. With retention enabled, Notes automatically removes retired empty records after Pi exits. A separate helper waits for the actual process to end before changing the saved tree. Reloading, forking and switching sessions do not trigger this cleanup. No command or additional confirmation is needed. No backup is kept. Memory savings apply when the pruned session next opens.

Physical cleanup currently requires Linux and an available `node` executable. Other platforms retain live payload pruning. Cleanup skips another registered local Notes process using the same saved session, known open-file holders and files that change during preparation. A simultaneous reopen is checked against the saved generation. If cleanup won that race, the new Pi process stops and asks you to reopen it rather than continue with a stale tree. Failures are reported when the session next opens. Tree branches, labels, compaction boundaries and supported Notes archive references are retained. Other content and saved notes are unchanged.

Coordination covers local processes running this Notes release under the same OS user. Keep session storage free of concurrent writers from other machines, other OS users, older Notes versions and external JSONL editors while a Notes-enabled process is closing. Unrelated sessions do not block cleanup.

Update Observatory before applying if you use its historical index. Older versions may block the rewritten file. Current versions reconcile removed records without discarding indexed statistics.

### Roles

`/roles` lists configured roles. You can also choose **Roles** in Notes. Tab
and Shift-Tab switch between the Notes and Board settings tabs. Edit
`<Pi agent directory>/notes-compaction/model-roles.json` to define roles:

```json
{
	"roles": [
		{
			"id": "planning",
			"description": "Sustained planning and design work",
			"provider": "your-provider",
			"model": "your-model-id",
			"reasoning": "high"
		}
	]
}
```

Create the parent directory and file if missing. Use an available Pi provider
and exact model ID. Role IDs start with a lowercase letter and contain only
lowercase letters, numbers and hyphens. Reasoning accepts `off`, `minimal`,
`low`, `medium`, `high`, `xhigh` or `max`. Roles have no shipped model assignments.
Changes apply on the next turn or when reopening the list. All defined roles
are available to the agent. The old `enabled` property is ignored.

The agent sees its selected role and the available role descriptions, not
the model or reasoning settings. After saving a checkpoint, it can pass a
configured role ID to `new_context` to switch in the same session. Omit the
role to keep the current one. A Shepherdr spawn profile does not select a
Notes role.

Notes must be active for both models. Pi handles authentication and clamps
unsupported reasoning levels. Provider capabilities and context limits still
apply, and switching does not guarantee cache reuse. Context retirement and
recovery keep their existing Notes settings.

### Notes settings

`/notes` opens the settings panel in interactive Pi. It shows continuity status, storage counts and remote capabilities. Changes save immediately.

- **Enabled** selects **Off**, **On** for all models, or **Whitelist**. Whitelist enables Notes only for exact model IDs in the global settings file, regardless of provider. Off disables Notes independently of Board. Switching models applies the choice immediately. Inactive Notes defers initialisation, but can still load saved continuity to preserve an earlier history cut.
- **Normal compaction** uses the installed Pi or PCC compaction flow for `/compact` and `new_context`. Off keeps notes-only rollover, the default.
- **New window requests** controls the agent's `new_context` tool independently of the compaction method. **off** disables the tool. **pi-limits** uses Pi's eligibility check and continues in the current window when there is too little history. **unrestricted**, the default, accepts requests at any size. With normal compaction on and nothing to summarise, unrestricted requests open a new window identity without discarding the existing context. Manual `/compact` and idle rollover retain their separate policies.
- **Task-completion rollover** permits `resume: false` in `new_context`. Off by default. Checkpoint and new-window eligibility rules still apply. Aborting or failing the run cancels its pending task-completion rollover.
- **Idle rollover** selects the interval or disables it.
- **Prune missing sessions** removes notes, cached responses and history index entries for missing session files after confirmation. Unknown paths, permission errors and the active session are retained.

Notes are stored as plaintext in `<Pi agent directory>/notes-compaction/notes.sqlite`, honoring `PI_CODING_AGENT_DIR`. Saved session snapshots preserve notes across forks and branch navigation, including after database pruning. Existing plaintext PCC notes remain readable without an import. On first use, saved PCC notes continuity settings migrate to Notes when no Notes settings file exists. Existing Notes settings take precedence.

The whitelist lives under `notes` in the global `pi-agent-comms.json`:

```json
{
	"notes": {
		"active": "whitelist",
		"modelWhitelist": ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6-luna"],
		"normalCompaction": false
	}
}
```

Add or remove model IDs and reload Pi. Copy the model's exact ID, without Pi's provider selector prefix. If the ID itself contains slashes, keep them. Entries are literal matches, not patterns. A new model is inactive in Whitelist mode until you add its ID.

## Optional remote lookup

With a compatible PCC provider, note reads and searches automatically combine local notes with remote results. Remote response bytes are cached verbatim in SQLite. Cached lookups can be reused offline, with their original coverage and an explicit exact-query limit. Encrypted listings cannot be searched or expanded locally into queries that were never cached.

New writes always stay local and work with any model. `write_file` replaces the local path and takes precedence over a remote read of that path. `append_to_file` adds a local overlay when no local replacement exists. Remote base content and the overlay remain separate. List and search results label local replacements as authoritative because opaque remote results can contain older versions.

Encrypted remote content needs a compatible provider bridge and the user's compatible OpenAI setup. The cache does not decrypt content or make it portable across incompatible setups. Without compatible delivery, local notes remain usable and the result reports that cached remote content is unavailable.
