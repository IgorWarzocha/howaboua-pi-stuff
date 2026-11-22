# @howaboua/pi-agent-comms

## 0.0.5

- Replaces standalone Notes Compaction and Agent Board. Remove the old extensions when switching. Their settings move to `pi-agent-comms.json`; saved data stays in place. Features without prior settings start off.
- Added `/board viewer` to open the read-only browser viewer directly.
- Added Conversation and Full rollover tails for notes-only `/compact` and idle rollover. Both keep conversation after the last completed Notes save on the selected branch. Full also keeps complete tool-call groups.
- Idle rollover with a tail now asks for a checkpoint when no save qualifies, then releases your original prompt and attachments.
- Settings clarify ranked history search, when pruning runs, how Notes rollovers differ from compaction, and what Board thread consolidation does.
- Code and Notebook list History alongside Notes. Notes, History and Board use compact help in every prompt mode.
- Notes help shows which fields list, search, read and write return.
- Fixed Board replies using the `reply` alias failing Notebook type checks.

## 0.0.4

- Context rollover keeps the explicitly selected role instead of inferring it from the model or reasoning level. A temporary reasoning boost expiring no longer blocks role switches.
- `/roles` shows role names and descriptions first in a read-only Pi list.
- Agents use configured role descriptions to decide whether a substantial new phase calls for a switch.
- Notes guidance clarifies what to checkpoint before rollover and reminds continuing agents to recover their notes and resume unfinished work.
- Notes reads, lists and searches reuse the same loaded notes.
- Fixed shared Notes reads and lists failing for a remote-backed parent session.
- History reads do less work per page, and ranked searches reuse unchanged search scopes.
- Shorter board guidance clarifies how to copy a full thread ID and recover from closed threads.
- Board accepts `reply` as an alias for posting to a thread.

## 0.0.3

- Added `new_context({resume: false})` to finish a reply and open fresh context without continuing automatically.
- Added same-cell rollover after an awaited note save in Code and Notebook.
- Role guidance now directs agents to choose presets for sustained phase changes.
- Unknown shortened UUIDs now report how to retry without scanning saved conversations. Full addresses and live routing remain available.
- Notes, History and Board examples no longer prescribe `await`.
- New Notes whitelists use GPT-6.2 Sol and Astra alongside GPT-6 Luna.

## 0.0.2

- Notes lookup warnings now distinguish unavailable remote notes from local checkpoints.
- Notes guidance calls for fewer, shorter updates, using task notes and/or checkpoints with History links instead of copied investigation or harness detail.
- Notes guidance keeps no-action report updates to their ID and outcome when checkpointing is needed.
- Retired session records are removed automatically after Pi exits.
- Board guidance skips report posts without a new peer-relevant change.
- Board guidance keeps distinct topics in focused threads instead of catch-alls.
- Communication guidance distinguishes non-waking notes and board posts from direct messages, regardless of messaging tool.
- Notes and Board settings now open on matching Enabled controls.

## 0.0.1

- Requires Node.js 22.19 or newer.
  - Initial release combining session notes, searchable history, context rollover and agent boards. Agent Comms is an alternative to the maintained standalone Notes Compaction and Agent Board packages, preserving existing data and settings. Do not load both alternatives together.
  - Notes and Board work independently and initialise on demand. Each has an Off setting.
  - Notes reads accept `end_line` as an alias for `stop_line`.
  - `/notes` and `/board` open their settings tabs. The Board tab opens the discussion viewer.
  - Added context recovery from saved checkpoints and selected past user messages, with current instructions taking precedence.
  - Shared Notes and Board references account for recipient access, with self-contained replies when access is unavailable or unknown.
