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

### @howaboua/pi-ask — 0.0.10

- Requires Pi 1.0.0 or later.

  Fixed Ask text cursor and input-method candidate window placement in Pi's fullscreen interface.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.16

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.7

- Better Skills now hides the skill catalog from Pi, Code Mode, and Notebook Mode prompts while preserving native `/skill:<name>` commands.

  Remove `--no-skills` from launch wrappers or aliases. Separate catalog-clearing hooks are no longer needed.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.6

- Requires Pi 1.0.0 or later.

  Browser now uses help-first discovery in ordinary Pi and Structured mode. Native calls accept help and single or batched JSON requests through `command`, matching Code and Notebook. Existing object calls remain supported.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 3.0.43

- Requires Pi 1.0.0 or later.

  - Notebook management now uses `{"input":"help"}` and JSON actions through `input`, with guidance for startup recovery.
  - Added `tools.history` and `tools.notes` inside Code and Notebook for Local, Tree and Remote storage. Remote inputs are visible in execution source and traces; encrypted results reach the model without exposing their contents to JavaScript. Native Remote calls retain encrypted inputs.
  - Added optional **New window after 25 minutes idle** under `/codex context`. With Notes and history, the next prompt opens a new window only when the last completed run saved fresh notes. Incoming agent messages use the same rollover checks.
  - Tree navigation now loads saved handoff notes before resuming. Failed reads cancel the jump.
  - Fixed low-context reminders restarting completed replies.
  - MCP discovery now starts from server summaries with complete contracts in `ALL_TOOLS`. Promoted custom-tool changes and removals are announced before the next request.
  - Fixed Usage history loading when Pi and the extension are installed separately. Standalone ledger reports require `--file`; session scans require `--root`.
  - Fixed conversation replay across Responses model and execution-mode changes.
  - Fixed voice progress and final replies when realtime voice starts during ongoing Pi work.
  - Added `xhigh` and `max` to Auto reasoning's `change_reasoning` tool.
  - WebSocket setup now overlaps request preparation. Compaction warmup reconnects dropped sockets and reuses matching history.
  - Updated the Sites custom-tool example with Site-hosted MCP guidance, slug changes, Worker logs, database reads, schedules and atomic private-source publishing with saved-version recovery.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.9

- Requires Pi 1.0.0 or later.

  Updated Undici to 8.10.2 with security fixes.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.6

- Requires Pi 1.0.0 or later.

  Updated Undici to 8.10.2 with security fixes.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-dynamic-tools — 0.0.9

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-dynamic-tools/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.15

- Explorer prompts now use concise evidence maps and explicit unknowns without fixed-length report templates or repeated discovery instructions.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.85

- Include bundled package updates:

  - @howaboua/pi-better-skills-tool: Better Skills now hides the skill catalog from Pi, Code Mode, and Notebook Mode prompts while preserving native `/skill:<name>` commands. Remove `--no-skills` from launch wrappers or aliases. Separate catalog-clearing hooks are no longer needed.
  - @howaboua/pi-shepherdr: Shepherdr now tells agents to use an enabled shared board for plans, decisions and findings in substantial multi-agent work, while keeping task assignment and urgent messages in agents. Spawned agents receive the same guidance.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.24

- Requires Pi 1.0.0 or later.

  Updated Undici to 8.10.2 with security fixes.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.4

- The `/sol` shortcut now selects GPT-6.1 Sol while preserving configured context and reasoning defaults.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.5

- Memory extraction now uses supplied context without assuming that global or project instruction files were loaded.

[Full changelog](./packages/pi-memories/CHANGELOG.md)

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

### @howaboua/pi-shepherdr — 0.2.11

- Shepherdr now tells agents to use an enabled shared board for plans, decisions and findings in substantial multi-agent work, while keeping task assignment and urgent messages in agents. Spawned agents receive the same guidance.

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

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.5

- Harness audits now stay within the requested workflow, reuse supplied context and measure startup overhead only when in scope.

  Tool-design guidance now prefers on-demand help for unfamiliar multi-action or state-dependent tools, while preserving familiar native contracts and simple schemas.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.23

- Include bundled package updates:

  - @howaboua/pi-skill-harness-and-agent-engineering: Harness audits now stay within the requested workflow, reuse supplied context and measure startup overhead only when in scope. Tool-design guidance now prefers on-demand help for unfamiliar multi-action or state-dependent tools, while preserving familiar native contracts and simple schemas.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.8

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.93

- Include bundled package updates:

  - @howaboua/pi-better-skills-tool: Better Skills now hides the skill catalog from Pi, Code Mode, and Notebook Mode prompts while preserving native `/skill:<name>` commands. Remove `--no-skills` from launch wrappers or aliases. Separate catalog-clearing hooks are no longer needed.
  - @howaboua/pi-shepherdr: Shepherdr now tells agents to use an enabled shared board for plans, decisions and findings in substantial multi-agent work, while keeping task assignment and urgent messages in agents. Spawned agents receive the same guidance.

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

