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

### @howaboua/pi-agent-board — 0.0.8

- Board catch-up examples no longer prescribe `await`.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-agent-comms — 0.0.3

- Added `new_context({resume: false})` to finish a reply and open fresh context without continuing automatically.
- Added same-cell rollover after an awaited note save in Code and Notebook.
- Role guidance now directs agents to choose presets for sustained phase changes.
- Unknown shortened UUIDs now report how to retry without scanning saved conversations. Full addresses and live routing remain available.
- Notes, History and Board examples no longer prescribe `await`.
- New Notes whitelists use GPT-6.2 Sol and Astra alongside GPT-6 Luna.

[Full changelog](./packages/pi-agent-comms/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.20

- Ask help now identifies `handoff` as a boolean.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.19

- GPT mode uses note-style priming, commit-summary and voice guidance.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.13

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Removed the TypeBox installation requirement.

  Skills discovery examples no longer prescribe `await`.

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

### @howaboua/pi-chatgpt-sites — 0.0.4

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Replaced the TypeBox dependency with Pi's native schema builders.

  Sites documentation examples no longer prescribe `await`.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 5.0.1

- Added VM Code with conversation-local bindings, top-level `await`, bounded memory and hard cancellation.
- Added GPT-6.2 Sol and Astra with live reasoning controls and API-equivalent cost estimates.
- TS mode now uses tsrs 0.25 with TypeScript 7.1 beta.
- Tool images now appear once and respect visibility settings.
- Image-heavy Code results now retain cached previews when toggling details.
- Cache logs now locate prompt changes without recording prompt text.
- Tool examples no longer prescribe `await`.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.15

- Generated images now display once in ordinary and nested tool results.
- Image generation help no longer prescribes `await` or `.then()` syntax.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.11

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Replaced the TypeBox dependency with Pi's native schema builders.

  Web search examples no longer prescribe `await`.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.108

- Include bundled package updates:

  - @howaboua/pi-ask: Ask help now identifies `handoff` as a boolean.
  - @howaboua/pi-better-skills-tool: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Removed the TypeBox installation requirement. Skills discovery examples no longer prescribe `await`.
  - @howaboua/pi-github-watch: PR watches now notify when the head commit changes, even without a new comment or review.
  - @howaboua/pi-gpt-switcher: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - `/sol` and `/astra` now select GPT-6.2 Sol and Astra, including without Codex Conversion. - Context defaults are now 500K for Sol, Terra and Luna, and 256K for Astra. Existing preferences are preserved.
  - @howaboua/pi-pet: The animated pet canvas now exposes its accessible name to screen readers.
  - @howaboua/pi-shepherdr: - Fixed resumed workers failing to start or losing completion reports after crashes or restarts. - Fixed agent launches and window focus in standalone Bun builds of Pi. - Sender labels now show machine, full agent address and terminal without repeated labels. - Empty turns from unassigned workers no longer trigger completion notices. - Agent guidance now favours outcome-focused delegation, actionable handoffs and fewer duplicate completion messages. - Tool examples no longer prescribe `await`. - New general profiles use GPT-6.2 Sol.
  - @howaboua/pi-subagent-review: - New review configurations use GPT-6.2 Sol. - Custom reviewer model IDs now use Pi's CLI instead of falling back when their provider is configured.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.32

- Voice task acknowledgements now omit unused task IDs.
- Bundled voice helpers now use refreshed Rust dependencies.
- Local voice tools now use Pi's native schema types instead of TypeBox.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.7

- PR watches now notify when the head commit changes, even without a new comment or review.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.7

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

  - `/sol` and `/astra` now select GPT-6.2 Sol and Astra, including without Codex Conversion.
  - Context defaults are now 500K for Sol, Terra and Luna, and 256K for Astra. Existing preferences are preserved.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.6

- Voice task acknowledgements now omit unused task IDs.
- Voice context timestamps now use minute precision.
- Bundled audio helpers now use refreshed Rust dependencies.
- Local voice tools now use Pi's native schema types instead of TypeBox.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-notes-compaction — 0.0.18

- Added `new_context({resume: false})` to finish a reply and open fresh context without continuing automatically.
- Added same-cell rollover after an awaited note save in Code and Notebook.
- Role guidance now directs agents to choose presets for sustained phase changes.
- Unknown shortened UUIDs now report how to retry without scanning saved conversations. Full addresses and live routing remain available.
- Notes and History examples no longer prescribe `await`.
- New Notes whitelists use GPT-6.2 Sol and Astra alongside GPT-6 Luna.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.5

- Keep retained session details and historical statistics available after sparse history pruning.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.9

- The animated pet canvas now exposes its accessible name to screen readers.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.6

- Fixed short sandbox commands occasionally reporting a startup failure.
- Sandbox creation dates now use minute precision.
- Removed the TypeBox installation requirement.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 1.0.2

- Fixed resumed workers failing to start or losing completion reports after crashes or restarts.
- Fixed agent launches and window focus in standalone Bun builds of Pi.
- Sender labels now show machine, full agent address and terminal without repeated labels.
- Empty turns from unassigned workers no longer trigger completion notices.
- Agent guidance now favours outcome-focused delegation, actionable handoffs and fewer duplicate completion messages.
- Tool examples no longer prescribe `await`.
- New general profiles use GPT-6.2 Sol.

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

### @howaboua/pi-stuff — 0.0.116

- Include bundled package updates:

  - @howaboua/pi-ask: Ask help now identifies `handoff` as a boolean.
  - @howaboua/pi-better-skills-tool: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Removed the TypeBox installation requirement. Skills discovery examples no longer prescribe `await`.
  - @howaboua/pi-github-watch: PR watches now notify when the head commit changes, even without a new comment or review.
  - @howaboua/pi-gpt-switcher: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - `/sol` and `/astra` now select GPT-6.2 Sol and Astra, including without Codex Conversion. - Context defaults are now 500K for Sol, Terra and Luna, and 256K for Astra. Existing preferences are preserved.
  - @howaboua/pi-pet: The animated pet canvas now exposes its accessible name to screen readers.
  - @howaboua/pi-shepherdr: - Fixed resumed workers failing to start or losing completion reports after crashes or restarts. - Fixed agent launches and window focus in standalone Bun builds of Pi. - Sender labels now show machine, full agent address and terminal without repeated labels. - Empty turns from unassigned workers no longer trigger completion notices. - Agent guidance now favours outcome-focused delegation, actionable handoffs and fewer duplicate completion messages. - Tool examples no longer prescribe `await`. - New general profiles use GPT-6.2 Sol.
  - @howaboua/pi-subagent-review: - New review configurations use GPT-6.2 Sol. - Custom reviewer model IDs now use Pi's CLI instead of falling back when their provider is configured.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.27

- New review configurations use GPT-6.2 Sol.
- Custom reviewer model IDs now use Pi's CLI instead of falling back when their provider is configured.

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

