# Changelog

## 0.0.1

Initial monorepo release for the Howaboua Pi package collection.

This repository brings the previously separate Pi packages into one Bun workspace while keeping every package separately installable. It also adds aggregate packages for installing everything, extensions only, or skills only:

- `@howaboua/pi-stuff`
- `@howaboua/pi-extensions`
- `@howaboua/pi-skills`

Legacy package history remains in the original package changelogs where available:

- [`@howaboua/pi-auto-reasoning-tool`](./packages/pi-auto-reasoning-tool/CHANGELOG.md)
- [`@howaboua/pi-codex-conversion`](./packages/pi-codex-conversion/CHANGELOG.md)

Going forward, package-level changelogs remain the source of truth for each package, and this top-level changelog summarizes monorepo-wide releases.

<!-- package-changelog-summary -->

## Latest package changelogs

### @howaboua/pi-ask — 0.0.5

### Changes

- [#269](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/269) [`6138ffd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6138ffd735bb4f7f80e451320dbfd0933a4acaa7) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
  - Announce compaction and stream conversational Pi updates after two sentences.
  - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
  - Configure delegation acknowledgements and deliver V3 delegations immediately.
  - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
  - Reduce LAN playback dropouts with one more jitter-buffer frame.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-reasoning-tool — 0.1.11

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-auto-reasoning-tool/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.13

### Changes

- [#269](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/269) [`6138ffd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6138ffd735bb4f7f80e451320dbfd0933a4acaa7) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
  - Announce compaction and stream conversational Pi updates after two sentences.
  - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
  - Configure delegation acknowledgements and deliver V3 delegations immediately.
  - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
  - Reduce LAN playback dropouts with one more jitter-buffer frame.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 3.0.17

### Changes

- [#329](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/329) [`1d91df3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1d91df3f605a557958500bb40d14be576306f3a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep idle Codex cache refreshes on the exact provider request that produced the active cache, every 25 minutes, without disturbing the live WebSocket continuation or presenting `generate:false` usage as cache telemetry.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

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

### @howaboua/pi-extensions — 0.0.62

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Review a focused JJ revision when its workspace cursor is an empty child commit.

- Updated dependencies [[`536910d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/536910d3b0a89f1caaa7a37844bdb80b62c1f844)]:
  - @howaboua/pi-subagent-review@0.2.19

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.13

### Changes

- [#304](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/304) [`4b4e42f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4b4e42f7659e42854ec81cb502bf69a48422d9eb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Run Pi Pet as a first-class GipPity companion.

  - Meet Clawa through the browser, voice, desktop dictation, a transparent desktop window, or the headless pet-state feed.
  - Import compatible Codex and ChatGPT pets or author new pets through free-form `/pet` requests.
  - Keep authored pets and generated displays in durable Pi agent storage, with optional per-repository pet selection.
  - Attach the local device directly or remote devices through Pi-owned SSH sessions, with each folder remembering where its sessions appear.
  - Get exact install and reload guidance when GipPity Control is missing or outdated.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.0

### Changes

- [#164](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/164) [`b8731f6`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b8731f68c8b6cbfb167e29728aad07fb59e560bb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add `/sol`, `/terra`, and `/luna` commands for switching GPT-5.6 Codex models and reasoning levels.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-markdown-workflows — 0.2.20

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

[Full changelog](./packages/pi-markdown-workflows/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.4

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-memories/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.1

### Changes

- [#304](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/304) [`4b4e42f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4b4e42f7659e42854ec81cb502bf69a48422d9eb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Run Pi Pet as a first-class GipPity companion.

  - Meet Clawa through the browser, voice, desktop dictation, a transparent desktop window, or the headless pet-state feed.
  - Import compatible Codex and ChatGPT pets or author new pets through free-form `/pet` requests.
  - Keep authored pets and generated displays in durable Pi agent storage, with optional per-repository pet selection.
  - Attach the local device directly or remote devices through Pi-owned SSH sessions, with each folder remembering where its sessions appear.
  - Get exact install and reload guidance when GipPity Control is missing or outdated.

- Updated dependencies [[`4b4e42f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4b4e42f7659e42854ec81cb502bf69a48422d9eb)]:
  - @howaboua/pi-gippity-control@0.0.13

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-semantic-grep — 0.1.19

### Changes

- [#239](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/239) [`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make indexing non-blocking at session startup.
  - Use a single writer with atomic, resumable rebuilds.
  - Respect ignore rules and prioritize metadata, batching, and roles.
  - Preserve usable prior indexes across interrupted rebuilds.

[Full changelog](./packages/pi-semantic-grep/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.1.2

### Changes

- [#298](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/298) [`b20e7de`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b20e7de137fe89344bc15b06c7e7e0bf02a896b3) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Orchestrate Pi agents across named remote Herdr machines with automatic SSH bridge deployment and explicit reconnect controls.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-adversarial-qa — 0.0.1

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add the adversarial-qa skill for falsifying code behaviour with property, differential, mutation, and fuzz testing.

[Full changelog](./packages/pi-skill-adversarial-qa/CHANGELOG.md)

### @howaboua/pi-skill-agent-native-hardening — 0.0.6

### Changes

- [#166](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/166) [`5118fd9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5118fd9c29c050316a4fa1cf9122b501710e7056) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add execution-topology guidance for agent-navigable call stacks.
  - Measure import, initialization, startup, and bundle performance.

[Full changelog](./packages/pi-skill-agent-native-hardening/CHANGELOG.md)

### @howaboua/pi-skill-agents-md — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

[Full changelog](./packages/pi-skill-agents-md/CHANGELOG.md)

### @howaboua/pi-skill-anti-ai-copy — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

[Full changelog](./packages/pi-skill-anti-ai-copy/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-codex-prompt-caching — 0.0.1

### Changes

- [#214](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/214) [`2023aa0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2023aa005da4d32f9af0b9bc161c9224d8c60486) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add a Codex prompt-caching skill covering GPT-5.6 caching, Codex request continuity, Pi hooks, compaction, dynamic tools, measurement, and extension review.

[Full changelog](./packages/pi-skill-codex-prompt-caching/CHANGELOG.md)

### @howaboua/pi-skill-gh-issue-pr-flow — 0.0.7

### Changes

- [#168](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/168) [`70c9973`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/70c9973b8509d2ebefc26acef5c25d1e01b47d47) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Cull feature-existence and implementation-coupled tests before final PR submission, retaining only independently justified contract coverage.

[Full changelog](./packages/pi-skill-gh-issue-pr-flow/CHANGELOG.md)

### @howaboua/pi-skill-gh-stack — 0.0.2

### Changes

- [#231](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/231) [`f05fa46`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f05fa469e034ec0e47f238f213437e5a11f2b13c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add tested noninteractive command guidance.
  - Lazy-load command and recovery references.
  - Add machine-readable state contracts and issue-batch stack design.

[Full changelog](./packages/pi-skill-gh-stack/CHANGELOG.md)

### @howaboua/pi-skill-model-facing-api-design — 0.0.5

### Changes

- [#149](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/149) [`94b2252`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/94b225295be07e04206460963fd3da754a74565e) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Document model-facing punctuation and token-cost hygiene

[Full changelog](./packages/pi-skill-model-facing-api-design/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skill-project-reference-research — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

[Full changelog](./packages/pi-skill-project-reference-research/CHANGELOG.md)

### @howaboua/pi-skill-skill-creator — 0.0.5

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

[Full changelog](./packages/pi-skill-skill-creator/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.16

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-gh-stack:
    - Add tested noninteractive command guidance.
    - Lazy-load command and recovery references.
    - Add machine-readable state contracts and issue-batch stack design.

- Updated dependencies [[`f05fa46`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f05fa469e034ec0e47f238f213437e5a11f2b13c)]:
  - @howaboua/pi-skill-gh-stack@0.0.2

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.6

### Changes

- [#235](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/235) [`5657b77`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5657b778f59ffa2eb86f10f7e949f060d95eb993) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in summaries.
  - Assemble complete multi-block, delta-only RPC streaming updates.
  - Remove retired Smart BTW shortcut-capture and voice-helper exports.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.67

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Review a focused JJ revision when its workspace cursor is an empty child commit.

- Updated dependencies [[`536910d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/536910d3b0a89f1caaa7a37844bdb80b62c1f844)]:
  - @howaboua/pi-subagent-review@0.2.19

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.19

### Changes

- [#314](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/314) [`536910d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/536910d3b0a89f1caaa7a37844bdb80b62c1f844) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Review a focused JJ revision when its workspace cursor is an empty child commit.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.0

### Changes

- [#295](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/295) [`b3c662a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b3c662abe45472e7b720cc900421164e1f137ee6) Thanks [@howaclawa](https://github.com/howaclawa)! - Add terminal-native Unicode bar, line, scatter, sparkline, and heatmap rendering for explicit `chart` Markdown blocks

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.10

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

