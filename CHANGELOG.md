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

### @howaboua/pi-agent-comms — 0.0.7

- Context-window notices now expand and collapse on click as well as with the keyboard shortcut.

[Full changelog](./packages/pi-agent-comms/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.23

- Shortened Ask replies, steering receipts and invalid-field errors. Errors still list valid fields.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.16

- Shortened the truncated skill output footer to the byte range and continuation command.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.16

- Shortened browser timeout and tab-creation errors. They say what may have happened and what to check before retrying.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-chatgpt-sites — 0.0.7

- Shortened Sites errors. When deployment fails after saving, the error includes the saved version ID for a deploy-only retry.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 5.1.2

- Hotfix: Shell guidance now directs agents to resume on the completion report instead of polling with empty `write_stdin` calls.
- Hotfix: Persistent execution guidance now directs agents to scope one-off work to blocks and use distinct names for retained bindings. Redeclaration errors now suggest using a block or a different name.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.18

- Shortened Image Gen errors for OpenAI API, legacy Codex and configured-provider access.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.14

- Shortened Web Run errors for unavailable routes, account access and access challenges.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.111

- Bundled updates:

  - **@howaboua/pi-ask**: Shortened Ask replies, steering receipts and invalid-field errors. Errors still list valid fields.
  - **@howaboua/pi-better-skills-tool**: Shortened the truncated skill output footer to the byte range and continuation command.
  - **@howaboua/pi-gippity-control**: Shortened voice setup, unsent-task and call-ending messages.
  - **@howaboua/pi-github-watch**: Shortened watch receipts and notifications. Help explains when automatic updates arrive.
  - **@howaboua/pi-shepherdr**:

    - Shortened delegation help, agent receipts and recovery messages.
    - Final worker reports suggest following up on material uncertainties.
    - Herdr command help distinguishes automatic background exit reports from calls that need `hc wait`.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.35

- Shortened voice setup, unsent-task and call-ending messages.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.10

- Shortened watch receipts and notifications. Help explains when automatic updates arrive.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.7

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

  - `/sol` and `/astra` now select GPT-6.2 Sol and Astra, including without Codex Conversion.
  - Context defaults are now 500K for Sol, Terra and Luna, and 256K for Astra. Existing preferences are preserved.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.9

- Shortened xAI credential errors, voice task receipts and reconnect guidance.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.6

- The investigation guide distinguishes read-only evidence gathering from starting the viewer or collectors.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.11

- Unknown reaction errors show the exact `pet_show` call to list valid actions.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.8

- Sandbox help shows default CPU and RAM, resource profiles and service preview options.
- Shortened error messages for uncertain starts, incomplete templates and services that have not become ready.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 1.0.5

- Shortened delegation help, agent receipts and recovery messages.
- Final worker reports suggest following up on material uncertainties.
- Herdr command help distinguishes automatic background exit reports from calls that need `hc wait`.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.5

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Give Chrome CDP agents bounded snapshots and screenshots with non-aliasing reusable element references, broader ARIA control support, targeted search, serialized daemon commands, released remote object handles, revalidated native clicks, identity-safe referenced-field input, Shadow DOM support, actionable timeout recovery, and reliable linked CLI execution.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-code — 0.0.5

- Narrowed skill activation: `code-review` applies to reviewing changes, and `codebase-hygiene` applies to changing maintained code.
- Updated guidance for focused review, dependency changes, read-only reference checkouts and disposable scratchpads.

[Full changelog](./packages/pi-skill-code/CHANGELOG.md)

### @howaboua/pi-skill-foundations — 0.0.4

- Added `writing` for prose and interface copy, including telegraphic style, and `non-code-review` for documents, plans and designs.
- Narrowed `communication` to conversation, investigation reports and teaching.
- Updated `agents-md` and `skill-creator` to add guidance only where it changes behaviour.

[Full changelog](./packages/pi-skill-foundations/CHANGELOG.md)

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.9

- Updated session diagnosis and prompt-cache guidance to verify the live session, trace the first cache miss, and distinguish cache hits from continuation and prewarm.
- Updated extension design guidance on when to add tools and how to measure startup cost without sacrificing task success.
- Tool design now requires signalling failures through the host's error mechanism.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.28

- Bundled updates:

  - **@howaboua/pi-skill-code**:

    - Narrowed skill activation: `code-review` applies to reviewing changes, and `codebase-hygiene` applies to changing maintained code.
    - Updated guidance for focused review, dependency changes, read-only reference checkouts and disposable scratchpads.

  - **@howaboua/pi-skill-foundations**:

    - Added `writing` for prose and interface copy, including telegraphic style, and `non-code-review` for documents, plans and designs.
    - Narrowed `communication` to conversation, investigation reports and teaching.
    - Updated `agents-md` and `skill-creator` to add guidance only where it changes behaviour.

  - **@howaboua/pi-skill-harness-and-agent-engineering**:

    - Updated session diagnosis and prompt-cache guidance to verify the live session, trace the first cache miss, and distinguish cache hits from continuation and prewarm.
    - Updated extension design guidance on when to add tools and how to measure startup cost without sacrificing task success.
    - Tool design now requires signalling failures through the host's error mechanism.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.119

- Bundled updates:

  - **@howaboua/pi-ask**: Shortened Ask replies, steering receipts and invalid-field errors. Errors still list valid fields.
  - **@howaboua/pi-better-skills-tool**: Shortened the truncated skill output footer to the byte range and continuation command.
  - **@howaboua/pi-gippity-control**: Shortened voice setup, unsent-task and call-ending messages.
  - **@howaboua/pi-github-watch**: Shortened watch receipts and notifications. Help explains when automatic updates arrive.
  - **@howaboua/pi-shepherdr**:

    - Shortened delegation help, agent receipts and recovery messages.
    - Final worker reports suggest following up on material uncertainties.
    - Herdr command help distinguishes automatic background exit reports from calls that need `hc wait`.

  - **@howaboua/pi-skill-code**:

    - Narrowed skill activation: `code-review` applies to reviewing changes, and `codebase-hygiene` applies to changing maintained code.
    - Updated guidance for focused review, dependency changes, read-only reference checkouts and disposable scratchpads.

  - **@howaboua/pi-skill-foundations**:

    - Added `writing` for prose and interface copy, including telegraphic style, and `non-code-review` for documents, plans and designs.
    - Narrowed `communication` to conversation, investigation reports and teaching.
    - Updated `agents-md` and `skill-creator` to add guidance only where it changes behaviour.

  - **@howaboua/pi-skill-harness-and-agent-engineering**:

    - Updated session diagnosis and prompt-cache guidance to verify the live session, trace the first cache miss, and distinguish cache hits from continuation and prewarm.
    - Updated extension design guidance on when to add tools and how to measure startup cost without sacrificing task success.
    - Tool design now requires signalling failures through the host's error mechanism.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.10

- Updates use Pi's native changelog notices and `collapseChangelog` instead of custom suppression.
- Nested AGENTS.md guidance is saved once per delivery without duplicating its text in session metadata.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.4

- Disabled suggestions no longer scan conversation history. Enabled suggestions scan it once per request.
- Suggestion requests no longer repeat the draft instruction on every turn.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.6

- Chart instructions always use the compact format. Pi Codex Conversion is no longer needed to select it.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

