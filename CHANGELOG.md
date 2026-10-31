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

### @howaboua/pi-agent-board — 0.0.4

- - Board and connected extension briefings now refresh after Notes context-window rollover.
  - Board listings now omit internal session identifiers.
  - GPT mode uses note-style Board help and briefings.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.17

- - Removed redundant help-call instructions from Ask's help.
  - GPT mode uses note-style question and handoff guidance.

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

### @howaboua/pi-codex-conversion — 4.0.7

- Updated package dependencies.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.12

- - Report invalid or unreadable tool configuration without parser or filesystem diagnostics.
  - GPT mode uses note-style image-generation guidance in Code and Notebook.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.10

- Added an extension API for Web Run search and navigation, using the existing provider and login without adding conversation messages.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.102

- Updated bundled packages.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.30

- Updated package dependencies.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.4

- - GPT mode uses note-style watch help.
  - Active watch results now state that updates arrive automatically without polling or a separate CLI watch.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.6

- Added `/terra` to switch to GPT-6.1 Terra with configurable context and reasoning defaults.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.4

- Updated package dependencies.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-notes-compaction — 0.0.13

- Model roles are now agent-operated. Configure them in `model-roles.json`. `/roles` is read-only, and the old `enabled` flag and accept/dismiss controls no longer apply.
- Added `new_context({role})` to continue the next context window on a role's configured model and reasoning after saving a checkpoint.
- Agents receive role names, descriptions and guidance to switch only for sustained scope changes, with subagents considered for bounded specialist work.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.3

- Cache diagnostics now index with less disk-sync overhead.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.7

- Added empty-call reaction discovery, including when no pet is connected, and deferred Code and Notebook help.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.4

- Fixed TypeScript calls rejecting action objects while equivalent JSON strings worked.
- Fixed concurrent first calls failing while the sandbox client was loading.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.2.25

- When switching from the older Herdr TUI or another Core instance, reselect local watches.
- Added Herdr Core and Herdr app support for local and remote delegation, focus, voice transfers, shared Notes and boards, including Windows hosts.
- Added Core session discovery by terminal title, with spaces, hyphens and underscores treated alike.
- Added `/herdr close-idle` to close idle children spawned by the current session branch, leaving attached and busy sessions open.
- Spawn results now return `contextAgent` and `boardAgent` inside `sharing` instead of at the top level. The agent `target` is unchanged.
- Reduced resume delays in sessions with many delegated agents, including closed children.
- Remote sharing helpers now start only when sharing is used or restored, avoiding idle polling on unrelated machines.
- Fixed intermediate tool calls being reported as completed agent work.
- Agent guidance now distinguishes automatic background reports from blocking calls that must be awaited.
- Agent tool declarations now accept action fields discovered through help, including in native codemode.

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

### @howaboua/pi-stuff — 0.0.110

- Updated bundled packages.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.25

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.2

- Added editable Markdown instructions in /suggestions, with defaults favouring productive next actions and avoiding repeated requests or completed work.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.3

- GPT mode uses note-style chart guidance.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

