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

### @howaboua/pi-codex-conversion — 3.0.44

- Code and Notebook modes now import Pi-callable extension tools automatically, preferring explicit integrations through the Pi Codex Conversion API.

  - Pi automatic compaction and `/compact` now stay in the current window with Notes + history + compaction. Explicit `new_context` still compacts before rollover.
  - Added **Use notes for tree summaries**, on by default. Turning it off uses Pi's ordinary branch summary without a note-writing run.
  - Added Local and Tree notes/history access for existing agents attached through Shepherdr, preserving their original identity and read-only checkpoint access after detachment or owner exit.
  - Removed static environment, history availability and summary claims from context rollover messages.

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

### @howaboua/pi-extensions — 0.0.86

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Manage orchestration, board defaults and SSH connections in `/herdr`, and attach existing agents without replacing their context. Control panel - `/herdr` opens Settings, Status and Connections instead of toggling orchestration. Panel controls replace `/herdr board` and `/herdr connect`; outside the TUI, `/herdr` reports status without changes. - Add SSH machines through Herdr's interactive setup, preserving its installation approvals and machine catalog. Inspect connection errors and reconnect from Status. - Fixed board startup when the global agent directory overlaps the launch folder's `.pi` directory. The global config is no longer mistaken for folder config. Agent attachment - `agents` gains `attach` and `detach` with independent context and board choices that persist across resume. Agent management stays in the tool, not the human panel. - Local and Tree notes/history retain their original identities and use aliases for shared access. Board attachment preserves previous archives. - Detachment retains read-only counterpart checkpoints. After an owner exits, reads use its reachable saved session or a timestamped retained snapshot with an explicit staleness warning. Counterpart history still needs its live owner. - Remote notes/history attachment is unsupported; board-only attachment remains available.

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

### @howaboua/pi-shepherdr — 0.2.12

- Manage orchestration, board defaults and SSH connections in `/herdr`, and attach existing agents without replacing their context.

  ### Control panel
  - `/herdr` opens Settings, Status and Connections instead of toggling orchestration. Panel controls replace `/herdr board` and `/herdr connect`; outside the TUI, `/herdr` reports status without changes.
  - Add SSH machines through Herdr's interactive setup, preserving its installation approvals and machine catalog. Inspect connection errors and reconnect from Status.
  - Fixed board startup when the global agent directory overlaps the launch folder's `.pi` directory. The global config is no longer mistaken for folder config.

  ### Agent attachment
  - `agents` gains `attach` and `detach` with independent context and board choices that persist across resume. Agent management stays in the tool, not the human panel.
  - Local and Tree notes/history retain their original identities and use aliases for shared access. Board attachment preserves previous archives.
  - Detachment retains read-only counterpart checkpoints. After an owner exits, reads use its reachable saved session or a timestamped retained snapshot with an explicit staleness warning. Counterpart history still needs its live owner.
  - Remote notes/history attachment is unsupported; board-only attachment remains available.

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

### @howaboua/pi-stuff — 0.0.94

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Manage orchestration, board defaults and SSH connections in `/herdr`, and attach existing agents without replacing their context. Control panel - `/herdr` opens Settings, Status and Connections instead of toggling orchestration. Panel controls replace `/herdr board` and `/herdr connect`; outside the TUI, `/herdr` reports status without changes. - Add SSH machines through Herdr's interactive setup, preserving its installation approvals and machine catalog. Inspect connection errors and reconnect from Status. - Fixed board startup when the global agent directory overlaps the launch folder's `.pi` directory. The global config is no longer mistaken for folder config. Agent attachment - `agents` gains `attach` and `detach` with independent context and board choices that persist across resume. Agent management stays in the tool, not the human panel. - Local and Tree notes/history retain their original identities and use aliases for shared access. Board attachment preserves previous archives. - Detachment retains read-only counterpart checkpoints. After an owner exits, reads use its reachable saved session or a timestamped retained snapshot with an explicit staleness warning. Counterpart history still needs its live owner. - Remote notes/history attachment is unsupported; board-only attachment remains available.

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

