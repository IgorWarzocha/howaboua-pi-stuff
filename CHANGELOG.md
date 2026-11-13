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

### @howaboua/pi-agent-board — 0.0.7

- Board settings now open on Enabled with On and Off choices.
- Board guidance reserves direct messages for assignments and urgent action, regardless of messaging tool; posts do not wake idle agents.
- Board guidance skips report posts without a new peer-relevant finding, decision, ownership change or blocker.
- Board guidance keeps distinct topics in focused threads instead of catch-alls.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-agent-comms — 0.0.2

- Notes lookup warnings now distinguish unavailable remote notes from local checkpoints.
- Notes guidance calls for fewer, shorter updates, using task notes and/or checkpoints with History links instead of copied investigation or harness detail.
- Notes guidance keeps no-action report updates to their ID and outcome when checkpointing is needed.
- Retired session records are removed automatically after Pi exits.
- Board guidance skips report posts without a new peer-relevant change.
- Board guidance keeps distinct topics in focused threads instead of catch-alls.
- Communication guidance distinguishes non-waking notes and board posts from direct messages, regardless of messaging tool.
- Notes and Board settings now open on matching Enabled controls.

[Full changelog](./packages/pi-agent-comms/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.19

- Requires Node.js 22.19 or newer.
  - Replaced the TypeBox dependency with Pi's native schema builders and validation.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.19

- GPT mode uses note-style priming, commit-summary and voice guidance.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.12

- - Skills now shows its exact discovery call in Code and Notebook modes and clarifies batch-read syntax in help.
  - GPT mode uses note-style skill discovery and reading guidance.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.13

- Fixed npm-installed Pi Browser blocking startup when Pi Codex Conversion is installed.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-chatgpt-sites — 0.0.3

- - Sites calls now return their payload directly instead of an outer `result` wrapper.
  - Errors show the problem and recovery information without diagnostic envelopes.
  - GPT mode uses note-style guide and schema discovery.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 5.0.0

### Breaking changes

- Replaced JS Notebook with QuickJS Code. Existing `js` settings now run fresh JavaScript per call, with up to four concurrent cells. Notebook checkpoints, profiles and project-shared variables are no longer available in this mode. Existing saved files remain untouched but are not loaded.
- QuickJS Code retains conversation-local JSON through `store` and `load` without disk persistence.
- Exact patch success acknowledgements now use `OK`. Incomplete-change warnings remain unchanged.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.14

- Replaced the TypeBox dependency with Pi's native schema builders and validation.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.10

- Added an extension API for Web Run search and navigation, using the existing provider and login without adding conversation messages.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.107

- Include bundled package updates:

  - @howaboua/pi-github-watch: Return `OK` after cancelling all watches.
  - @howaboua/pi-shepherdr: Reduce CPU use when monitoring long sessions.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.32

- Voice task acknowledgements now omit unused task IDs.
- Bundled voice helpers now use refreshed Rust dependencies.
- Local voice tools now use Pi's native schema types instead of TypeBox.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.6

- Return `OK` after cancelling all watches.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.6

- Added `/terra` to switch to GPT-6.1 Terra with configurable context and reasoning defaults.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.6

- Voice task acknowledgements now omit unused task IDs.
- Voice context timestamps now use minute precision.
- Bundled audio helpers now use refreshed Rust dependencies.
- Local voice tools now use Pi's native schema types instead of TypeBox.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-notes-compaction — 0.0.17

- Notes lookup warnings now distinguish unavailable remote notes from local checkpoints.
- Notes guidance calls for fewer, shorter updates, using task notes and/or checkpoints with History links instead of copied investigation or harness detail.
- Notes guidance keeps no-action report updates to their ID and outcome when checkpointing is needed.
- Retired session records are removed automatically after Pi exits.
- Notes guidance distinguishes non-waking writes from direct messages, regardless of messaging tool.
- Notes settings now open on Enabled, with Off, On and Whitelist choices.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.5

- Keep retained session details and historical statistics available after sparse history pruning.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.8

- Requires Pi 1.5 or newer and Node.js 22.19 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Pet-authoring metadata now records UTC timestamps to the minute.
  - Removed the TypeBox installation requirement.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.6

- Fixed short sandbox commands occasionally reporting a startup failure.
- Sandbox creation dates now use minute precision.
- Removed the TypeBox installation requirement.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 1.0.1

- Reduce CPU use when monitoring long sessions.

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

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.8

- Pi extension guidance now recommends native schema builders and validation.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.27

- Include bundled package updates:

  - @howaboua/pi-skill-harness-and-agent-engineering: Pi extension guidance now recommends native schema builders and validation.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.8

- GPT-6 Sol and Luna now share Astra's Codex support.
  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.115

- Include bundled package updates:

  - @howaboua/pi-github-watch: Return `OK` after cancelling all watches.
  - @howaboua/pi-shepherdr: Reduce CPU use when monitoring long sessions.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.26

- Requires Pi 1.5 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Conversation summaries now use minute-precision timestamps.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.3

- Requires Pi 1.5 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Fixed ghost suggestions in empty editors with decorated prompt prefixes, including `pi-powerline-footer`.
  - Added an off-by-default chat model fallback for unavailable or failed suggestion models.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.4

- Requires Pi 1.5 or newer.
  - Other extensions' later prompt sections now reach the model in interactive sessions.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

