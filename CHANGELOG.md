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

### @howaboua/pi-auto-trees — 0.1.15

- Keep custom messages out of the editor when returning to their markers with `/end`. Preserve the marked context by navigating to its existing checkpoint rather than reopening the message for editing.

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

### @howaboua/pi-codex-conversion — 3.0.32

- Fix Notebook's first-run Deno installation in standalone Pi by loading the archive extractor through the extension's static module graph.

- Reduced installation dependencies without removing Notebook or shell-summary features.

  - Removed the general ZIP library and Bash grammar package's native install hook.
  - Removed the tokenizer dependency and unused encodings while preserving compaction token counts.
  - Updated OpenAI, Undici, and the shell parser runtime, including transport security fixes.

- Deliver peer messages directly to Pi without submitting unsent human drafts.

  - Preserve slash-command arguments and use the target session's skill and prompt-template expansion.
  - Return submission-only acknowledgements for registered extension commands instead of waiting for an assistant reply.

  Requires Pi 0.84.4 or newer. Update and reload Shepherdr on both controllers and workers, and Pi Codex Conversion where installed.

- Fixed idle agent reports and manual checkpoint requests to preserve prompt preparation, coalesce concurrent continuations, and process reports arriving during turn settlement.

  - Manual Compact reuses notes saved in the last completed turn for Local, Tree, and Remote notes-only windows, avoiding a redundant checkpoint turn. Explicit compaction instructions still request a checkpoint.
  - Compact tool output now offers Off, On, and Minimal. Minimal keeps nested tool results and an expand hint while hiding the trailing Code / Notebook text preview until expanded. Existing Off and On settings keep their behavior.
  - Shepherdr help makes local routing explicit: agent calls default to the host running Pi, while unfiltered discovery searches all machines. Remote calls use profile IDs, not machine labels or hostnames.
  - Fixed Shepherdr startup after a Herdr executable replacement leaves a stale ` (deleted)` path. Recovery silently uses the replacement at the same location. Command failures remain visible and no longer imply that Herdr is outdated.

- Streamed realtime replies now return their final text to the requesting delegation instead of leaving the entire answer in general session context.

  - Context-window rollover now requests a brief spoken acknowledgement before voice-context refresh, including notes-only mode.
  - Voice context refresh now preserves the summary and queues arriving spoken requests across call replacement instead of discarding them. Accepted speech finishes on the current call before replacement.
  - Session diagnostics retain voice call, transcript and delegation identities with text hashes to distinguish event replay from fresh recognition.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.4

- Image generation and editing now request gpt-image-2.5. Proxy model mappings must use gpt-image-2.5 as their canonical key.

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

### @howaboua/pi-extensions — 0.0.72

- Include bundled package updates:

  - @howaboua/pi-auto-trees: Keep custom messages out of the editor when returning to their markers with `/end`. Preserve the marked context by navigating to its existing checkpoint rather than reopening the message for editing.
  - @howaboua/pi-gippity-control: Streamed realtime replies now return their final text to the requesting delegation instead of leaving the entire answer in general session context.
  - @howaboua/pi-shepherdr: Deliver peer messages directly to Pi without submitting unsent human drafts. - Preserve slash-command arguments and use the target session's skill and prompt-template expansion. - Return submission-only acknowledgements for registered extension commands instead of waiting for an assistant reply. Requires Pi 0.84.4 or newer. Update and reload Shepherdr on both controllers and workers, and Pi Codex Conversion where installed.
  - @howaboua/pi-shepherdr: Fixed idle agent reports and manual checkpoint requests to preserve prompt preparation, coalesce concurrent continuations, and process reports arriving during turn settlement. - Manual Compact reuses notes saved in the last completed turn for Local, Tree, and Remote notes-only windows, avoiding a redundant checkpoint turn. Explicit compaction instructions still request a checkpoint. - Compact tool output now offers Off, On, and Minimal. Minimal keeps nested tool results and an expand hint while hiding the trailing Code / Notebook text preview until expanded. Existing Off and On settings keep their behavior. - Shepherdr help makes local routing explicit: agent calls default to the host running Pi, while unfiltered discovery searches all machines. Remote calls use profile IDs, not machine labels or hostnames. - Fixed Shepherdr startup after a Herdr executable replacement leaves a stale ` (deleted)` path. Recovery silently uses the replacement at the same location. Command failures remain visible and no longer imply that Herdr is outdated.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.18

- Streamed realtime replies now return their final text to the requesting delegation instead of leaving the entire answer in general session context.

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

### @howaboua/pi-shepherdr — 0.2.1

- Deliver peer messages directly to Pi without submitting unsent human drafts.

  - Preserve slash-command arguments and use the target session's skill and prompt-template expansion.
  - Return submission-only acknowledgements for registered extension commands instead of waiting for an assistant reply.

  Requires Pi 0.84.4 or newer. Update and reload Shepherdr on both controllers and workers, and Pi Codex Conversion where installed.

- Fixed idle agent reports and manual checkpoint requests to preserve prompt preparation, coalesce concurrent continuations, and process reports arriving during turn settlement.

  - Manual Compact reuses notes saved in the last completed turn for Local, Tree, and Remote notes-only windows, avoiding a redundant checkpoint turn. Explicit compaction instructions still request a checkpoint.
  - Compact tool output now offers Off, On, and Minimal. Minimal keeps nested tool results and an expand hint while hiding the trailing Code / Notebook text preview until expanded. Existing Off and On settings keep their behavior.
  - Shepherdr help makes local routing explicit: agent calls default to the host running Pi, while unfiltered discovery searches all machines. Remote calls use profile IDs, not machine labels or hostnames.
  - Fixed Shepherdr startup after a Herdr executable replacement leaves a stale ` (deleted)` path. Recovery silently uses the replacement at the same location. Command failures remain visible and no longer imply that Herdr is outdated.

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

### @howaboua/pi-stuff — 0.0.79

- Include bundled package updates:

  - @howaboua/pi-auto-trees: Keep custom messages out of the editor when returning to their markers with `/end`. Preserve the marked context by navigating to its existing checkpoint rather than reopening the message for editing.
  - @howaboua/pi-gippity-control: Streamed realtime replies now return their final text to the requesting delegation instead of leaving the entire answer in general session context.
  - @howaboua/pi-shepherdr: Deliver peer messages directly to Pi without submitting unsent human drafts. - Preserve slash-command arguments and use the target session's skill and prompt-template expansion. - Return submission-only acknowledgements for registered extension commands instead of waiting for an assistant reply. Requires Pi 0.84.4 or newer. Update and reload Shepherdr on both controllers and workers, and Pi Codex Conversion where installed.
  - @howaboua/pi-shepherdr: Fixed idle agent reports and manual checkpoint requests to preserve prompt preparation, coalesce concurrent continuations, and process reports arriving during turn settlement. - Manual Compact reuses notes saved in the last completed turn for Local, Tree, and Remote notes-only windows, avoiding a redundant checkpoint turn. Explicit compaction instructions still request a checkpoint. - Compact tool output now offers Off, On, and Minimal. Minimal keeps nested tool results and an expand hint while hiding the trailing Code / Notebook text preview until expanded. Existing Off and On settings keep their behavior. - Shepherdr help makes local routing explicit: agent calls default to the host running Pi, while unfiltered discovery searches all machines. Remote calls use profile IDs, not machine labels or hostnames. - Fixed Shepherdr startup after a Herdr executable replacement leaves a stale ` (deleted)` path. Recovery silently uses the replacement at the same location. Command failures remain visible and no longer imply that Herdr is outdated.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.21

- Restore full extension prompt preparation when continuing into a new context window or starting review triage.

  - Keep tool instructions current through Pi's normal startup hooks without resetting the Notebook.
  - Let active context management own review-loop navigation summaries.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.5

- Directory listings load AGENTS.md guidance only for the queried scope, without preloading rules from every child they name. Explicit child access and content-search matches still load the relevant nested guidance.

  Fixed Windows drive-letter paths in content-search matches so they load nested guidance.

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

