# @howaboua/pi-agent-comms

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
