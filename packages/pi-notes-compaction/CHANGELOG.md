# @howaboua/pi-notes-compaction

## 0.0.13

- Model roles are now agent-operated. Configure them in `model-roles.json`. `/roles` is read-only, and the old `enabled` flag and accept/dismiss controls no longer apply.
- Added `new_context({role})` to continue the next context window on a role's configured model and reasoning after saving a checkpoint.
- Agents receive role names, descriptions and guidance to switch only for sustained scope changes, with subagents considered for bounded specialist work.

## 0.0.12

- Added `/roles` for model preferences across providers and optional model-switch recommendations that preserve the current conversation.
- Simplified Notes and History action names and Notes path and limit arguments. Existing calls remain supported.
- Fixed fresh child agents being unable to join shared Notes when another extension had saved startup metadata.
- Notes guidance now requires task checkpoints at meaningful milestones, completion and task switches, even before context runs low.

## 0.0.11

- - Fixed native SQLite addon crashes when saving notes or searching ranked history in standalone Bun-based Pi builds. Existing notes and history indexes remain compatible with Node-based Pi.
  - Fixed the session auto-pruning submenu losing its frame and disappearing during pruning. Preview, confirmation and progress now stay inside the menu.

## 0.0.10

- ### Features
  - Added per-session auto-pruning in `/notes`, with 5, 10 or 25 full-history windows and optional one-week or one-month conversation retention. Off by default, with a Run now preview. Current context and saved notes remain protected. Restart Pi for memory savings; `/reload` is not sufficient.
  - Added opt-in BM25-ranked history search in `/notes` for earlier user messages and assistant replies. Current context, tools and reasoning are excluded. Explicit tool-history, live-window and cross-agent searches retain literal matching.
  - Added subagent sharing and note-save marker settings to `/notes`, with migration from global and trusted-folder PCC preferences.
  - Added automatic read-only remote notes retrieval and recovery of saved PCC Tree history.
  - Added `pi-notes-compaction/context-sharing` with `connectNotesContextSharing` for orchestrators to share notes and history without PCC.

  ### History and recovery
  - Reduced memory use during Notes rollover in long sessions. Earlier windows remain accessible through History and Tree.

    **Expected compaction card:** This fix requires a native history cut, which displays Pi's compaction card. Pi currently provides no supported way to hide this card. It can be ignored; Notes is working as intended.

  - Tool descriptions now explain that Notes hands off task state between context windows. GPT prompt mode uses note-style guidance, history-search help and rollover reminders.
  - Notes guidance now directs each agent to keep checkpoints and reports in its own notes and share their paths.
  - Notes now accepts `read` as an alias for `read_file`.
  - With PCC, plaintext Notes and history calls inside `exec` now return objects instead of JSON strings.
  - With PCC, history now reads Pi session files instead of encrypted backend history.
  - Fixed returning to a saved-notes point in the session tree unnecessarily requesting another checkpoint instead of opening a new context window.
  - Prune missing sessions now also removes history index entries for missing session files.
  - Notes results now omit storage and routing bookkeeping while retaining read ranges, truncation and warnings about incomplete or outdated results.

## 0.0.9

- - Fixed history lookup errors to identify the missing ID and explain how to retry. History arguments now clarify that read_item requires both IDs.
  - GPT-mode checkpoint guidance uses denser prose.
  - New-window guidance tells agents to read task-relevant skills again.
  - Notes write receipts now contain only the saved path.
  - Idle rollover offers Off, 25m, 55m, 2h, 6h and 12h. Hour presets roll over five minutes early; saved 5- and 15-minute settings remain valid.

## 0.0.8

- **Continuity and integrations**
  - Fixed Notes guidance missing from PCC's first post-compaction cache-warming request.
  - With PCC active, Notes guidance uses developer-role delivery. Automatic rollover resumes from the window handoff itself, without a separate continuation message.
  - Initial window identity now follows the prepared system prompt, preserving the shared prefix for child-agent caching.
  - External integrations can adopt a new fork into a notes family before its first task without rewriting inherited history.

  **Guidance and discovery**
  - Added compact checkpoint guidance for PCC GPT prompt mode.
  - Simplified Notes and History discovery, with write, path and history-ID guidance in their help.
  - Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.

## 0.0.7

- Shared local agent history now remains readable after its owner closes or Shepherdr is removed.

## 0.0.6

- Requires Pi 1.2.0 or newer.
  - Added per-model activation through `/notes` and an editable whitelist.
  - Added **New window requests: off | pi-limits | unrestricted**. `new_context` requires a successful note write immediately beforehand.
  - Shared local notes now remain readable after their owner closes or Shepherdr is removed.
  - Fixed window identity and recovery guidance disappearing after compaction.
  - Continuations now apply Pi's full prompt and tool preparation.

## 0.0.5

- We've been informed that Astra and Sol currently retain their prompt caches for around an hour. If you use notes-managed idle rollover, consider increasing it from 25 to 55 minutes. Cache retention can vary. YMMV. We'll keep monitoring. Please share your cache-retention and long-context quota observations in [the feedback thread](https://github.com/IgorWarzocha/howaboua-pi-stuff/issues/508).

  Added configurable task-boundary reminders and a clearer settings layout.
  - Added optional reminders at preset or custom token counts when context capacity exceeds 272k, showing the remaining percentage.
  - Status text and keyboard hints now wrap to fit narrow terminals.
  - Notes help now lists required arguments. Writes accept `content` when `text` is omitted.
  - Fixed fresh worker startup with Notes enabled.

## 0.0.4

- Fixed note queries and manual context rollover with Codex Conversion.
  - Restored negative line ranges, default limits, result ordering, metadata and complete read and search content. Help now shows concrete call syntax, and invalid arguments are reported before execution.
  - `/compact` now honours the Normal compaction setting. With it off, Notes Compaction reuses fresh saved notes or requests a checkpoint, then opens a new context window without starting a continuation turn.

## 0.0.3

- Fixed shared agent startup after package updates when the startup changelog is present.

## 0.0.2

- Added a `/notes` settings panel for normal compaction, idle rollover, continuity status and confirmed pruning, replacing the subcommands and JSON status output.

## 0.0.1

- Added Notes Compaction: local checkpoint notes, searchable session history and notes-guided context windows for any Pi model, with optional Codex Conversion integration and cached remote lookup.
