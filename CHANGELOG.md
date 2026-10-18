# Changelog

## 0.0.1

Initial monorepo release for the Howaboua Pi package collection.

This repository brings the previously separate Pi packages into one Bun workspace while keeping every package separately installable. It also adds aggregate packages for installing everything, extensions only, or skills only:

- `@howaboua/pi-stuff`
- `@howaboua/pi-extensions`
- `@howaboua/pi-skills`

Legacy Pi Codex history remains in its [package changelog](./packages/pi-codex-conversion/CHANGELOG.md).

Going forward, package-level changelogs remain the source of truth for each package, and this top-level changelog summarizes monorepo-wide releases.

<!-- package-changelog-summary -->

## Latest package changelogs

### @howaboua/pi-agent-board — 0.0.2

- **Thread status and summaries**

  - Added parent-only thread status changes with open, completed and abandoned states and recorded comments. Closed threads must be reopened before replying.
  - Show thread status labels in the viewer and status on search results.
  - Closed threads now generate a summary through Pi's configured providers, preserving the discussion's language and register. Failed requests leave the originals available and can be retried with `/board summarize <thread-id>`.
  - Saved summaries replace discussions in default reads and searches; use `full: true` or the viewer controls for original posts. Reopening removes the summary.
  - Added a Luna/Custom summary-model selector under `/board settings`.

  **Guidance and discovery**

  - Use compact board help, briefings and catchup guidance in opt-in PCC GPT prompt mode.
  - Unified Board help discovery across native and nested tools.
  - Unread board catchup now uses developer messages when Codex Conversion is active.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.15

- Use consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.17

- Use compact priming, commit-summary and voice guidance in opt-in PCC GPT prompt mode.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.10

- Use consistent skill discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.9

- Use consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-chatgpt-sites — 0.0.2

- Streamlined tool descriptions and on-demand help discovery. Guide contents are unchanged.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 4.0.2

- **Compatibility and retention**

  - Code Mode always uses the pinned official OpenAI runtime. Local builds and `tools.customRustBinariesDir` no longer override it. Other native helper overrides are unchanged.
  - Code runtime downloads now honour proxy environment settings.
  - Notebook journals now expire after one week without updates by default. `/codex` also offers indefinite retention or switching recording off and removing saved journals.
  - Added optional session-checkpoint cleanup after one month or one week of inactivity. Cleanup is off by default.

  **PCC GPT prompt mode and tools**

  - Added an opt-in experimental PCC GPT prompt mode built on Heavy, with compact instructions and a shared mode API for participating extensions. Existing off/on settings are unchanged.
  - Code and Notebook use one discovery rule for help-backed tools, keeping arguments in on-demand help instead of repeated startup instructions.
  - Built-in history and notes return usage for empty calls and explicit help requests without accessing storage.
  - Code and Notebook accept either `max_files` or `max_results` for note search and listing limits.
  - Updated bundled patch and path helpers to Codex 0.163 while preserving line endings and partial-failure results.
  - Removed the custom-tool example for the retired Semantic Grep extension.

  **Context and connection reliability**

  - WebSocket connection recovery allows up to three fresh retries within five minutes after the first failure, then switches to SSE with its own five-minute recovery window.
  - Repeated V2 compaction preserves active context-window guidance.
  - Post-compaction cache warming uses the same native tool catalogue as generation.
  - Initial context-window identity follows the prepared system prompt so it does not break the shared cache prefix.
  - Automatic rollover resumes from the developer-role window handoff itself, without a separate continuation message. No-work notices also use developer-role delivery.
  - Child-agent integrations can bind fresh or explicitly forked sessions and share cache routing without sharing execution state.
  - Standard Codex requests now send base instructions as a leading developer message, matching Responses Lite and current OpenAI Codex, without inventing a prompt when none is supplied.
  - Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.

  **Responsiveness and diagnostics**

  - Usage-ledger updates and reports now run off the main thread to keep Pi responsive as usage history grows.
  - Reduced history projection work for message-only histories.
  - Diagnostics now distinguish logical requests from retries and socket sends, including compaction and cache-warming traffic.
  - Unexecuted tool proposals now show Pending without retaining renderer callbacks.
  - Fixed source previews losing their tool background when truncated.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.

  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.11

- - Added compact tool guidance for PCC GPT prompt mode. Other modes are unchanged.
  - Removed unused Rust reference sources from the package download. Image generation behaviour is unchanged.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.8

- - Added compact tool guidance for PCC GPT prompt mode. Other modes are unchanged.
  - Removed unused Rust reference sources from the package download. Web search behaviour is unchanged.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.15

- Explorer prompts now use concise evidence maps and explicit unknowns without fixed-length report templates or repeated discovery instructions.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.97

- Include bundled package updates:

  - @howaboua/pi-ask: Use consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.
  - @howaboua/pi-auto-trees: Use compact priming, commit-summary and voice guidance in opt-in PCC GPT prompt mode.
  - @howaboua/pi-better-skills-tool: Use consistent skill discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.
  - @howaboua/pi-github-watch: - Added GitHub Actions run watches that wake the session when a run finishes. Completed runs return their result immediately. - Added consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode. - PR watches now surface unresolved review threads, including existing feedback, without repeated notifications for unchanged threads. Notices encourage replies and resolution after feedback is addressed. - Conversation watches now detect edits while ignoring the authenticated account's replies and duplicate inline-review receipts. - PR watches now stop when the PR is closed or merged. Already-closed PRs return their state without starting a watch.
  - @howaboua/pi-pet: Added empty-call reaction discovery, including when no pet is connected, and deferred Code and Notebook help.
  - @howaboua/pi-shepherdr: **Worker integrations** - Fresh workers now share their parent's cache routing with compatible Codex Conversion. Shared notes remain optional, and native sessions and histories remain separate. - Fresh workers inherit the live Board setting before their first request, keeping Board tools and guidance available from startup. - Added an optional Pulses runner with persistent workers, saved-session reuse and completion reports that wake the parent. **Agent tools and guidance** - Expanded tool calls now show outgoing tasks, messages, replies and focus handoffs in full. - Added compact agent help and hosted Board briefings for PCC GPT prompt mode. - Agent discovery now uses the same help contract across native, Code and Notebook tools. - Added delegation guidance for distinct scopes, shared project context and combined validation. - Invalid spawn names now explain naming limits and how to use a longer label. Spawn guidance favours short two-word names.
  - @howaboua/pi-unicode-charts: Use compact chart guidance in opt-in PCC GPT prompt mode.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.26

- ### Features
  - Select native microphones and speakers in settings, including system defaults and saved unavailable devices. Changes apply on the next local audio start without changing browser or handed-off audio.
  - Save voice and context-summary preferences from the LAN browser for the next call without restarting the current call or changing credentials or native devices. Project settings can disable globally configured context summaries.
  - Transfer voice through `agents focus`, retaining the microphone and browser connection while switching to the destination's context. Handoffs include attributed context and a return action without starting an agent task.
  - Choose primary and alternate voices in terminal or browser settings. Each session transfer alternates voices and greets the user in the destination's context.

  ### Fixes
  - Voice and dictation refuse startup while another voice provider is active in the same Pi session, including during reconnection and microphone transfer.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.2

- - Added GitHub Actions run watches that wake the session when a run finishes. Completed runs return their result immediately.
  - Added consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.
  - PR watches now surface unresolved review threads, including existing feedback, without repeated notifications for unchanged threads. Notices encourage replies and resolution after feedback is addressed.
  - Conversation watches now detect edits while ignoring the authenticated account's replies and duplicate inline-review receipts.
  - PR watches now stop when the PR is closed or merged. Already-closed PRs return their state without starting a watch.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.5

- Fixed model shortcuts rejecting configured context windows above their defaults.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.1

- ### Features

  Added Grok realtime voice with the current Pi agent doing the work.

  - Local audio on Linux, macOS and Windows, plus trusted-LAN browser control with live Pi activity.
  - Local and browser streaming dictation into an editable draft, with automatic language detection or an explicit language selection, without automatically sending requests.
  - Selectable voices, models and audio devices, custom Markdown instructions and conversation continuity summaries.
  - Session voice transfers through Shepherdr, retaining the original microphone and speakers. Each transfer alternates between configurable primary and alternate voices and greets the user in the destination's context.
  - Automatic connection recovery, saved transcripts and coordination with other active voice providers.
  - Custom voice tools and optional xAI web search.

  Uses the matching OAuth or API-key credential configured in Pi. Voice quota and billing depend on the account.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.5

- Memory extraction now uses supplied context without assuming that global or project instruction files were loaded.

[Full changelog](./packages/pi-memories/CHANGELOG.md)

### @howaboua/pi-notes-compaction — 0.0.8

- **Continuity and integrations**

  - Fixed Notes guidance missing from PCC's first post-compaction cache-warming request.
  - With PCC active, Notes guidance uses developer-role delivery. Automatic rollover resumes from the window handoff itself, without a separate continuation message.
  - Initial window identity now follows the prepared system prompt, preserving the shared prefix for child-agent caching.
  - External integrations can adopt a new fork into a notes family before its first task without rewriting inherited history.

  **Guidance and discovery**

  - Added compact checkpoint guidance for PCC GPT prompt mode.
  - Simplified Notes and History discovery, with write, path and history-ID guidance in their help.
  - Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.7

- Added empty-call reaction discovery, including when no pet is connected, and deferred Code and Notebook help.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.2

- Made help discovery consistent in Code and Notebook.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.2.22

- **Worker integrations**

  - Fresh workers now share their parent's cache routing with compatible Codex Conversion. Shared notes remain optional, and native sessions and histories remain separate.
  - Fresh workers inherit the live Board setting before their first request, keeping Board tools and guidance available from startup.
  - Added an optional Pulses runner with persistent workers, saved-session reuse and completion reports that wake the parent.

  **Agent tools and guidance**

  - Expanded tool calls now show outgoing tasks, messages, replies and focus handoffs in full.
  - Added compact agent help and hosted Board briefings for PCC GPT prompt mode.
  - Agent discovery now uses the same help contract across native, Code and Notebook tools.
  - Added delegation guidance for distinct scopes, shared project context and combined validation.
  - Invalid spawn names now explain naming limits and how to use a longer label. Spawn guidance favours short two-word names.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.5

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Give Chrome CDP agents bounded snapshots and screenshots with non-aliasing reusable element references, broader ARIA control support, targeted search, serialized daemon commands, released remote object handles, revalidated native clicks, identity-safe referenced-field input, Shadow DOM support, actionable timeout recovery, and reliable linked CLI execution.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-code — 0.0.3

- Scratchpad guidance now keeps one-off checks temporary and deletes their artifacts after use. Persistent projects require an explicit request to retain them.

[Full changelog](./packages/pi-skill-code/CHANGELOG.md)

### @howaboua/pi-skill-foundations — 0.0.3

- Communication guidance now uses a shorter baseline, rejects stock banter and checks apparent contradictions before conceding a mistake.

[Full changelog](./packages/pi-skill-foundations/CHANGELOG.md)

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.7

- Clarified help-backed tool design: ignore unused presentation hints without weakening validation of meaningful arguments.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.25

- Include bundled package updates:

  - @howaboua/pi-skill-harness-and-agent-engineering: Clarified help-backed tool design: ignore unused presentation hints without weakening validation of meaningful arguments.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.8

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.105

- Include bundled package updates:

  - @howaboua/pi-ask: Use consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.
  - @howaboua/pi-auto-trees: Use compact priming, commit-summary and voice guidance in opt-in PCC GPT prompt mode.
  - @howaboua/pi-better-skills-tool: Use consistent skill discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode.
  - @howaboua/pi-github-watch: - Added GitHub Actions run watches that wake the session when a run finishes. Completed runs return their result immediately. - Added consistent tool discovery across native, Code and Notebook modes, with compact help in PCC GPT prompt mode. - PR watches now surface unresolved review threads, including existing feedback, without repeated notifications for unchanged threads. Notices encourage replies and resolution after feedback is addressed. - Conversation watches now detect edits while ignoring the authenticated account's replies and duplicate inline-review receipts. - PR watches now stop when the PR is closed or merged. Already-closed PRs return their state without starting a watch.
  - @howaboua/pi-pet: Added empty-call reaction discovery, including when no pet is connected, and deferred Code and Notebook help.
  - @howaboua/pi-shepherdr: **Worker integrations** - Fresh workers now share their parent's cache routing with compatible Codex Conversion. Shared notes remain optional, and native sessions and histories remain separate. - Fresh workers inherit the live Board setting before their first request, keeping Board tools and guidance available from startup. - Added an optional Pulses runner with persistent workers, saved-session reuse and completion reports that wake the parent. **Agent tools and guidance** - Expanded tool calls now show outgoing tasks, messages, replies and focus handoffs in full. - Added compact agent help and hosted Board briefings for PCC GPT prompt mode. - Agent discovery now uses the same help contract across native, Code and Notebook tools. - Added delegation guidance for distinct scopes, shared project context and combined validation. - Invalid spawn names now explain naming limits and how to use a longer label. Spawn guidance favours short two-word names.
  - @howaboua/pi-unicode-charts: Use compact chart guidance in opt-in PCC GPT prompt mode.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.25

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.1

- Use compact chart guidance in opt-in PCC GPT prompt mode.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.11

- Vent now uses shorter tool guidance for recording repeated workflow friction after completing the task.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

