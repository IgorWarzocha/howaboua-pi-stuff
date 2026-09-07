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

### @howaboua/pi-ask — 0.0.8

- Shepherdr now discovers and answers waiting questions invoked inside Code and Notebook Mode.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.14

- Tree navigation and `/end` now carry conversation summaries through the active notes backend.

  - The agent turn ends after the requested note write, without a follow-up reply.
  - Arriving agents receive a branch summary directing them to read the note before resuming.
  - Default `/end` guidance is task-neutral.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.2

- Batch independent skill reads in one execution cell.

- Keep tool results actionable.

  - Browser evaluation errors preserve JavaScript exception details instead of a generic “Uncaught”.
  - Skill path inventories omit installed dependencies; reference reads list only the requested sources instead of repeating the full inventory.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.2

- Keep tool results actionable.

  - Browser evaluation errors preserve JavaScript exception details instead of a generic “Uncaught”.
  - Skill path inventories omit installed dependencies; reference reads list only the requested sources instead of repeating the full inventory.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 3.0.30

- Keep compaction checkpoints alongside notes with a Hybrid toggle for Local, Tree and Remote context management.

  - Use Responses V2 where supported and Pi summaries elsewhere; preserve Tree checkpoints and their exact replay tails across archival.
  - Request a notes checkpoint after completed tool turns before the configured compaction reserve, including after final replies.
  - Make notes-only `/compact` request a checkpoint and immediate rollover instead of cutting context; reuse notes just saved for the current state.
  - Give non-Astra models explicit notes and recovery guidance in every context-management mode.
  - Gather notes, history and compaction settings in a dedicated Context tab under `/codex`.
  - Explain every setting on selection, including dependencies and non-obvious effects.
  - Refresh active voice calls with a fresh summary on context handoffs as well as compaction, preserving mute and LAN ownership.
  - Keep deferred ideas and unrelated tasks in notes for later resumption without treating them as permission to implement.
  - Apply concise follow-through guidance to all models, including heavy system-prompt rewrite.
  - Keep reasoning-level bookkeeping out of Pi's default tree view while preserving model updates and replay.
  - Added nested tool completion subscriptions through `code-mode-hooks`, with original arguments and full results for extension-side tracking without expanding agent output. Existing preflight imports remain supported.

- Tree navigation and `/end` now carry conversation summaries through the active notes backend.

  - The agent turn ends after the requested note write, without a follow-up reply.
  - Arriving agents receive a branch summary directing them to read the note before resuming.
  - Default `/end` guidance is task-neutral.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.3

- Fixed Codex web search and image generation to use local Codex authentication on unrelated chat providers while preserving explicit Codex routes and optional Pi Codex integration. Removed Pi Codex package dependencies.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.2

- Fixed Codex web search and image generation to use local Codex authentication on unrelated chat providers while preserving explicit Codex routes and optional Pi Codex integration. Removed Pi Codex package dependencies.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-dynamic-tools — 0.0.8

### Changes

- [#195](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/195) [`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Correct Herdr delivery failures to acknowledge that messages may already be queued

[Full changelog](./packages/pi-dynamic-tools/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.13

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.70

- Include bundled package updates:

  - @howaboua/pi-ask: Shepherdr now discovers and answers waiting questions invoked inside Code and Notebook Mode.
  - @howaboua/pi-auto-trees: Tree navigation and `/end` now carry conversation summaries through the active notes backend. - The agent turn ends after the requested note write, without a follow-up reply. - Arriving agents receive a branch summary directing them to read the note before resuming. - Default `/end` guidance is task-neutral.
  - @howaboua/pi-shepherdr: Deliver blocked-agent handoffs even when transcripts are unavailable. - Reviewer spawns wait for their result before the controller continues. - Implementation subagents are instructed to work directly rather than delegate implementation again. - Discover and answer Pi Ask questions called inside Code and Notebook Mode. - Retain working local and remote monitoring during connection updates, distinguish incomplete coverage from disconnection, and report recovery. - Worker states now show their last-known status during incomplete monitoring. `/herdr connect` retries without replacing a working remote connection. - Catch worker completions during reconnect setup and cancel obsolete or stopped monitoring connections.
  - @howaboua/pi-dynamic-tools: Remove retired bundled extension.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.17

- Fixed waiting indicators for extension UI prompts.

- Voice summarisation now runs whenever Pi compacts, then starts a fresh realtime session.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.2

- Add /astra for GPT-6 Astra with low reasoning by default and an optional reasoning override.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.4

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-memories/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.3

- Expose Pi Pet's extension from the package root so aggregate extension packages can load it.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-semantic-grep — 0.1.19

### Changes

- [#239](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/239) [`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make indexing non-blocking at session startup.
  - Use a single writer with atomic, resumable rebuilds.
  - Respect ignore rules and prioritize metadata, batching, and roles.
  - Preserve usable prior indexes across interrupted rebuilds.

[Full changelog](./packages/pi-semantic-grep/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.1.6

- Deliver blocked-agent handoffs even when transcripts are unavailable.

  - Reviewer spawns wait for their result before the controller continues.
  - Implementation subagents are instructed to work directly rather than delegate implementation again.
  - Discover and answer Pi Ask questions called inside Code and Notebook Mode.
  - Retain working local and remote monitoring during connection updates, distinguish incomplete coverage from disconnection, and report recovery.
  - Worker states now show their last-known status during incomplete monitoring. `/herdr connect` retries without replacing a working remote connection.
  - Catch worker completions during reconnect setup and cancel obsolete or stopped monitoring connections.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.5

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Give Chrome CDP agents bounded snapshots and screenshots with non-aliasing reusable element references, broader ARIA control support, targeted search, serialized daemon commands, released remote object handles, revalidated native clicks, identity-safe referenced-field input, Shadow DOM support, actionable timeout recovery, and reliable linked CLI execution.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-code — 0.0.2

- Added React hygiene guidance for state, effects, identity, rendering, and framework ownership.

[Full changelog](./packages/pi-skill-code/CHANGELOG.md)

### @howaboua/pi-skill-foundations — 0.0.2

- Updated communication guidance for concise conversation, writing, teaching, and non-code review.

[Full changelog](./packages/pi-skill-foundations/CHANGELOG.md)

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.1

### Changes

- [#339](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/339) [`ee0220c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ee0220cdc44cd732dff9caf0c913e098ed14404f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Publish rebuilt portable skills in category packages

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.19

- Include bundled package updates:

  - @howaboua/pi-skill-code: Added React hygiene guidance for state, effects, identity, rendering, and framework ownership.
  - @howaboua/pi-skill-foundations: Updated communication guidance for concise conversation, writing, teaching, and non-code review.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.6

### Changes

- [#235](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/235) [`5657b77`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5657b778f59ffa2eb86f10f7e949f060d95eb993) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in summaries.
  - Assemble complete multi-block, delta-only RPC streaming updates.
  - Remove retired Smart BTW shortcut-capture and voice-helper exports.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.77

- Include bundled package updates:

  - @howaboua/pi-ask: Shepherdr now discovers and answers waiting questions invoked inside Code and Notebook Mode.
  - @howaboua/pi-auto-trees: Tree navigation and `/end` now carry conversation summaries through the active notes backend. - The agent turn ends after the requested note write, without a follow-up reply. - Arriving agents receive a branch summary directing them to read the note before resuming. - Default `/end` guidance is task-neutral.
  - @howaboua/pi-shepherdr: Deliver blocked-agent handoffs even when transcripts are unavailable. - Reviewer spawns wait for their result before the controller continues. - Implementation subagents are instructed to work directly rather than delegate implementation again. - Discover and answer Pi Ask questions called inside Code and Notebook Mode. - Retain working local and remote monitoring during connection updates, distinguish incomplete coverage from disconnection, and report recovery. - Worker states now show their last-known status during incomplete monitoring. `/herdr connect` retries without replacing a working remote connection. - Catch worker completions during reconnect setup and cancel obsolete or stopped monitoring connections.
  - @howaboua/pi-dynamic-tools: Remove retired bundled extension.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.20

- Preserve extension-owned messages while delivering true developer-role policy through compatible Pi Codex Responses adapters.

  - Add an optional custom-message API that retains caller rendering and restoration fields.
  - Route Shepherdr's unclaimed worker events and orchestration toggles through it, preserving ordinary Pi delivery when unavailable.
  - Send review preface/triage policy and realtime voice start/end guidance as developer messages without elevating raw reviewer findings, spoken delegations, or transcript tails.
  - Keep persisted developer messages in context across model switches, using ordinary Pi conversion on incompatible models.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.4

- Fixed repeated AGENTS.md context injection during repository discovery. Unchanged guidance stays deduplicated; new and edited files still load.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.0

### Changes

- [#295](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/295) [`b3c662a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b3c662abe45472e7b720cc900421164e1f137ee6) Thanks [@howaclawa](https://github.com/howaclawa)! - Add terminal-native Unicode bar, line, scatter, sparkline, and heatmap rendering for explicit `chart` Markdown blocks

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.10

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

