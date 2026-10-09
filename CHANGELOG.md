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

### @howaboua/pi-agent-board — 0.0.1

- ### Features

  Added Pi Agent Board, the standalone home for boards previously bundled with Shepherdr.

  - Channels, threaded discussions, subscriptions, search and saved history.
  - A read-only `/board` browser viewer with live updates and agent filters.
  - Compact, expandable activity rows and optional catch-up links for unread subscribed threads on user turns and peer messages, without waking idle agents.
  - Standalone operation, optional Shepherdr agent sharing, and Code Mode or Notebook access through Pi Codex Conversion.

  Requires Pi 1.1 or newer and Node.js 22.18 or newer. Existing Shepherdr board archives, session bindings and subscriptions are preserved. Board settings now live under `/board`. Install this extension in every participating session and reload Pi.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.12

- ### Improvements
  - Ask returns help when called without arguments, including an empty structured object. Explicit help remains supported.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.16

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.8

- ### Improvements
  - Skills returns its catalog with command guidance when called without arguments. Explicit help remains supported.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.8

- ### Improvements
  - Browser returns help when called without arguments, including an empty structured object. Explicit help remains supported.

  ### Fixes
  - Screenshots bring the target tab to the foreground, avoiding capture timeouts caused by background focus emulation.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-chatgpt-sites — 0.0.1

- ### Features
  - Added Pi Sites with site management, committed-source saves, deployment and on-demand documentation.
  - Tools are automatically deferred in Code Mode and Notebook.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 3.0.48

- ### Breaking changes
  - **BREAKING CHANGE:** Requires Pi 1.1.0 or newer. Update Pi before updating Codex Conversion.
  - **BREAKING CHANGE:** Sites tools moved to `@howaboua/pi-chatgpt-sites`. Remove the old `sites.toml`, `sites_documentation.toml` and companion directory, install the new extension, then reload Pi. Existing repository bindings are preserved. Calls now use `sites({resource, action, params})` and `sites_documentation({topic})`.

  ### Features
  - Added Ultrafast selection alongside per-family Fast Mode and a Daybreak toggle that selects an available access program without changing the model.
  - Support a separate notes extension while preserving Codex tools, cached remote lookup, cross-agent notes and history, and normal compaction. Compaction respects the active context window.
  - Select native microphones and speakers in settings, including system defaults and saved unavailable devices. Changes apply on the next local audio start.
  - Save voice and context-summary preferences from the LAN browser for the next call without restarting the current call. Project settings can disable globally configured context summaries.
  - Transfer voice through `agents focus`, retaining the microphone and browser connection while switching to the destination's context. Handoffs include attributed context and a return action without starting an agent task.
  - Choose primary and alternate voices in terminal or browser settings. Each session transfer alternates voices and greets the user in the destination's context.

  ### Improvements
  - Notebook returns help when called without arguments, including an empty structured object. Explicit help remains supported.
  - Reasoning guidance raises effort for difficult or uncertain work and lowers it for routine work. Exec guidance calls for timeouts on operations that might not finish on their own.
  - Notes guidance keeps task checkpoints at stable paths and separates reusable topic notes. Note-save bookmarks label the next user prompt as Notes. Selecting it in `/tree` restores the prompt at the saved checkpoint.
  - Pending remote notes, history results and completed-cell receipts no longer expire after 15 minutes. Long-running cells can accept more than 32 remote calls.

  ### Fixes
  - Cancelled runs no longer trigger checkpoint rollover, qualify for idle rollover or receive a Notes saved marker after cancellation.
  - Context-window history starts with the first applicable turn rather than model selection or tree navigation.
  - Preserve partial-answer labels during replay and compaction.
  - Fix voice context summaries for compacted conversations containing remote tool results.
  - Fix quota refresh after reloads and session switches.
  - Voice and dictation refuse startup while another voice provider is active, including during reconnection and microphone transfer.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.

  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.10

- Explain when image generation and web search need a separate legacy OpenAI Codex login rather than ChatGPT sign-in. Access failures now give concise guidance without exposing backend responses or addresses. Existing provider routing is unchanged.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.7

- Explain when image generation and web search need a separate legacy OpenAI Codex login rather than ChatGPT sign-in. Access failures now give concise guidance without exposing backend responses or addresses. Existing provider routing is unchanged.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-dynamic-tools — 0.0.9

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-dynamic-tools/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.15

- Explorer prompts now use concise evidence maps and explicit unknowns without fixed-length report templates or repeated discovery instructions.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.91

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Added slash-command discovery with configured descriptions for the current session or another agent, without executing commands or interrupting its work.

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

### @howaboua/pi-notes-compaction — 0.0.1

- Added Notes Compaction: local checkpoint notes, searchable session history and notes-guided context windows for any Pi model, with optional Codex Conversion integration and cached remote lookup.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.4

- Remove obsolete test-only helper exports without changing tool behavior.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-semantic-grep — 0.1.19

### Changes

- [#239](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/239) [`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make indexing non-blocking at session startup.
  - Use a single writer with atomic, resumable rebuilds.
  - Respect ignore rules and prioritize metadata, batching, and roles.
  - Preserve usable prior indexes across interrupted rebuilds.

[Full changelog](./packages/pi-semantic-grep/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.2.17

- Added slash-command discovery with configured descriptions for the current session or another agent, without executing commands or interrupting its work.

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

### @howaboua/pi-stuff — 0.0.99

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Added slash-command discovery with configured descriptions for the current session or another agent, without executing commands or interrupting its work.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.25

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.0

### Changes

- [#295](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/295) [`b3c662a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b3c662abe45472e7b720cc900421164e1f137ee6) Thanks [@howaclawa](https://github.com/howaclawa)! - Add terminal-native Unicode bar, line, scatter, sparkline, and heatmap rendering for explicit `chart` Markdown blocks

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.11

- Vent now uses shorter tool guidance for recording repeated workflow friction after completing the task.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

