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

### @howaboua/pi-agent-board — 0.0.3

- - Thread summaries are now opt-in. Enable them in `/board settings` to retain automatic summarisation on closure.
  - Removed the manual `/board summarize` and `/board inherit` commands.
  - Added `/board` command and scope completions so settings and Board controls are discoverable.
  - Added a Board settings action that prompts the current agent to consolidate related one-off threads without closing discussions.
  - GPT-mode startup briefings use denser guidance.
  - Board write receipts omit redundant metadata.
  - Board summaries omit model settings from tool results.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.16

- Use denser question and handoff help in PCC GPT prompt mode.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.18

- Use denser priming and commit-summary guidance in PCC GPT prompt mode.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.11

- - Skills help and catalog results now explain reference-only reads and batching skill bodies with references.
  - Invalid Code and Notebook calls now show no-argument discovery syntax.
  - GPT-mode catalog help uses denser guidance.
  - Skill results include structured read receipts for usage tracking, distinguishing references and continuation pages.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.10

- Use denser browser help in PCC GPT prompt mode.

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

### @howaboua/pi-codex-conversion — 4.0.4

- - Requires Pi 1.4 or newer.
  - Deferred tool loads remain anchored after tool removals or redefinitions.

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

### @howaboua/pi-extensions — 0.0.98

- Include bundled package updates:

  - @howaboua/pi-ask: Use denser question and handoff help in PCC GPT prompt mode.
  - @howaboua/pi-auto-trees: Use denser priming and commit-summary guidance in PCC GPT prompt mode.
  - @howaboua/pi-better-skills-tool: - Skills help and catalog results now explain reference-only reads and batching skill bodies with references. - Invalid Code and Notebook calls now show no-argument discovery syntax. - GPT-mode catalog help uses denser guidance. - Skill results include structured read receipts for usage tracking, distinguishing references and continuation pages.
  - @howaboua/pi-github-watch: Use denser watch help in PCC GPT prompt mode.
  - @howaboua/pi-shepherdr: - Worker roles now follow shared project instructions, preserving a longer common startup prefix and exact role whitespace across machines. Update and reload Shepherdr on controllers and worker hosts together. - Fixed broken remote connections causing unhandled pipe errors and leaving requests pending. - Worker-notice warnings now identify the affected machine and explain how to reconnect. - GPT-mode Board briefings use denser guidance. - Blocking agent calls can run in parallel while the controller waits for their results. - Launched workers identify themselves to compatible extensions so human-only features can stay off.
  - @howaboua/pi-suggestions: Add opt-in next-step suggestions for human terminal sessions, with editable inline drafts and /suggestions model, reasoning and on/off settings. Private prediction history reuses provider caching within each chat context window.
  - @howaboua/pi-unicode-charts: Use denser chart guidance in PCC GPT prompt mode.

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

### @howaboua/pi-github-watch — 0.0.3

- Use denser watch help in PCC GPT prompt mode.

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

### @howaboua/pi-notes-compaction — 0.0.9

- - Fixed history lookup errors to identify the missing ID and explain how to retry. History arguments now clarify that read_item requires both IDs.
  - GPT-mode checkpoint guidance uses denser prose.
  - New-window guidance tells agents to read task-relevant skills again.
  - Notes write receipts now contain only the saved path.
  - Idle rollover offers Off, 25m, 55m, 2h, 6h and 12h. Hour presets roll over five minutes early; saved 5- and 15-minute settings remain valid.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.1

- Added the initial standalone Observatory release with session usage and outcome views, custom collectors, a PCC cache tab and on-demand agent investigations. Opening the viewer updates it once, then pauses. Continuous monitoring is opt-in.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.7

- Added empty-call reaction discovery, including when no pet is connected, and deferred Code and Notebook help.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.2

- Made help discovery consistent in Code and Notebook.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.2.23

- - Worker roles now follow shared project instructions, preserving a longer common startup prefix and exact role whitespace across machines. Update and reload Shepherdr on controllers and worker hosts together.
  - Fixed broken remote connections causing unhandled pipe errors and leaving requests pending.
  - Worker-notice warnings now identify the affected machine and explain how to reconnect.
  - GPT-mode Board briefings use denser guidance.
  - Blocking agent calls can run in parallel while the controller waits for their results.
  - Launched workers identify themselves to compatible extensions so human-only features can stay off.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.5

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Give Chrome CDP agents bounded snapshots and screenshots with non-aliasing reusable element references, broader ARIA control support, targeted search, serialized daemon commands, released remote object handles, revalidated native clicks, identity-safe referenced-field input, Shadow DOM support, actionable timeout recovery, and reliable linked CLI execution.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-code — 0.0.4

- Removed the manual Codex PR review request template from repository-delivery guidance.

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

### @howaboua/pi-skills — 0.0.26

- Include bundled package updates:

  - @howaboua/pi-skill-code: Removed the manual Codex PR review request template from repository-delivery guidance.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.8

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.106

- Include bundled package updates:

  - @howaboua/pi-ask: Use denser question and handoff help in PCC GPT prompt mode.
  - @howaboua/pi-auto-trees: Use denser priming and commit-summary guidance in PCC GPT prompt mode.
  - @howaboua/pi-better-skills-tool: - Skills help and catalog results now explain reference-only reads and batching skill bodies with references. - Invalid Code and Notebook calls now show no-argument discovery syntax. - GPT-mode catalog help uses denser guidance. - Skill results include structured read receipts for usage tracking, distinguishing references and continuation pages.
  - @howaboua/pi-github-watch: Use denser watch help in PCC GPT prompt mode.
  - @howaboua/pi-shepherdr: - Worker roles now follow shared project instructions, preserving a longer common startup prefix and exact role whitespace across machines. Update and reload Shepherdr on controllers and worker hosts together. - Fixed broken remote connections causing unhandled pipe errors and leaving requests pending. - Worker-notice warnings now identify the affected machine and explain how to reconnect. - GPT-mode Board briefings use denser guidance. - Blocking agent calls can run in parallel while the controller waits for their results. - Launched workers identify themselves to compatible extensions so human-only features can stay off.
  - @howaboua/pi-suggestions: Add opt-in next-step suggestions for human terminal sessions, with editable inline drafts and /suggestions model, reasoning and on/off settings. Private prediction history reuses provider caching within each chat context window.
  - @howaboua/pi-unicode-charts: Use denser chart guidance in PCC GPT prompt mode.
  - @howaboua/pi-skill-code: Removed the manual Codex PR review request template from repository-delivery guidance.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.25

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.1

- Add opt-in next-step suggestions for human terminal sessions, with editable inline drafts and /suggestions model, reasoning and on/off settings. Private prediction history reuses provider caching within each chat context window.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.2

- Use denser chart guidance in PCC GPT prompt mode.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

