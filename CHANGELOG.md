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

### @howaboua/pi-ask — 0.0.9

- Removed redundant tool guidance from Ask, Shepherdr, Skills and Browser. Code and Notebook Mode now show one callable contract per tool, with detailed Browser and agent rules in help.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.15

- Keep custom messages out of the editor when returning to their markers with `/end`. Preserve the marked context by navigating to its existing checkpoint rather than reopening the message for editing.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.4

- The skills tool now reads mixed skills and unique cross-skill references in one call. Ambiguous reference names report their qualified choices.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.4

- Added session-owned background browser work and direct form controls.

  - Fill or clear fields, select options, and set checkbox states, including indeterminate checkboxes.
  - Press keys and shortcuts on the focused element.
  - Wait for an element, page text, or URL with cancellation and a bounded timeout.
  - Page snapshots now report checked, selected, expanded, and disabled states.
  - New tabs open in the background and keep rendering during control. Show them explicitly, list session-owned tabs, and close any tab by reference.
  - Tab ownership survives reloads, worker restarts, and visits to hidden browser pages. Old ownership records expire after 30 days of inactivity. Concurrent Pi sessions keep separate element references.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 3.0.36

- Adapt Codex, Imagegen, review, and GipPity to Pi 0.87.

  Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer.

  - Fixed Codex prompt and tool updates rewriting the cached conversation prefix.
  - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window.
  - Fixed Imagegen recent-image selection ignoring context removals and replacements.
  - Fixed review summaries and preface tracking ignoring context removals and replacements.
  - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.7

- Adapt Codex, Imagegen, review, and GipPity to Pi 0.87.

  Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer.

  - Fixed Codex prompt and tool updates rewriting the cached conversation prefix.
  - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window.
  - Fixed Imagegen recent-image selection ignoring context removals and replacements.
  - Fixed review summaries and preface tracking ignoring context removals and replacements.
  - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.3

- Remove retired Spark from Codex tool authentication preferences. Codex Conversion now explains biological-policy errors when the server omits an explanation.

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

### @howaboua/pi-extensions — 0.0.77

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Adapt Codex, Imagegen, review, and GipPity to Pi 0.87. Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer. - Fixed Codex prompt and tool updates rewriting the cached conversation prefix. - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window. - Fixed Imagegen recent-image selection ignoring context removals and replacements. - Fixed review summaries and preface tracking ignoring context removals and replacements. - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.
  - @howaboua/pi-subagent-review: Adapt Codex, Imagegen, review, and GipPity to Pi 0.87. Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer. - Fixed Codex prompt and tool updates rewriting the cached conversation prefix. - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window. - Fixed Imagegen recent-image selection ignoring context removals and replacements. - Fixed review summaries and preface tracking ignoring context removals and replacements. - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.21

- Adapt Codex, Imagegen, review, and GipPity to Pi 0.87.

  Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer.

  - Fixed Codex prompt and tool updates rewriting the cached conversation prefix.
  - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window.
  - Fixed Imagegen recent-image selection ignoring context removals and replacements.
  - Fixed review summaries and preface tracking ignoring context removals and replacements.
  - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.2

- Add /astra for GPT-6 Astra with low reasoning by default and an optional reasoning override.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.4

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

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

### @howaboua/pi-shepherdr — 0.2.4

- Fixed agent answers being refused when prompt or footer text contains "Review". Shepherdr now reads the complete outer Ask panel, including nested text editors, and refuses incomplete captures without sending input.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.5

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Give Chrome CDP agents bounded snapshots and screenshots with non-aliasing reusable element references, broader ARIA control support, targeted search, serialized daemon commands, released remote object handles, revalidated native clicks, identity-safe referenced-field input, Shadow DOM support, actionable timeout recovery, and reliable linked CLI execution.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-code — 0.0.3

- Scratchpad guidance now keeps one-off checks temporary and deletes their artifacts after use. Persistent projects require an explicit request to retain them.

[Full changelog](./packages/pi-skill-code/CHANGELOG.md)

### @howaboua/pi-skill-foundations — 0.0.2

- Updated communication guidance for concise conversation, writing, teaching, and non-code review.

[Full changelog](./packages/pi-skill-foundations/CHANGELOG.md)

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.3

- Refine agent tool design guidance around live route evidence, real caller decisions, and concise positive field instructions.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.21

- Include bundled package updates:

  - @howaboua/pi-skill-harness-and-agent-engineering: Refine agent tool design guidance around live route evidence, real caller decisions, and concise positive field instructions.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.7

- Remove obsolete test-only helper exports without changing tool behavior.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.85

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Adapt Codex, Imagegen, review, and GipPity to Pi 0.87. Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer. - Fixed Codex prompt and tool updates rewriting the cached conversation prefix. - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window. - Fixed Imagegen recent-image selection ignoring context removals and replacements. - Fixed review summaries and preface tracking ignoring context removals and replacements. - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.
  - @howaboua/pi-subagent-review: Adapt Codex, Imagegen, review, and GipPity to Pi 0.87. Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer. - Fixed Codex prompt and tool updates rewriting the cached conversation prefix. - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window. - Fixed Imagegen recent-image selection ignoring context removals and replacements. - Fixed review summaries and preface tracking ignoring context removals and replacements. - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.23

- Adapt Codex, Imagegen, review, and GipPity to Pi 0.87.

  Codex Conversion, Imagegen, and Subagent Review require Pi 0.87.0 or newer.

  - Fixed Codex prompt and tool updates rewriting the cached conversation prefix.
  - Context reminders no longer start an extra checkpoint turn if the current run already saved a note in the current window.
  - Fixed Imagegen recent-image selection ignoring context removals and replacements.
  - Fixed review summaries and preface tracking ignoring context removals and replacements.
  - Kept GipPity browser turn notifications from including full context previews and losing their fields to truncation.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.8

- Removed redundant developer-message wording while preserving review approval rules and nested AGENTS.md guidance.

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

