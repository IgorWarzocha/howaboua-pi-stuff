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

### @howaboua/pi-ask — 0.0.4

### Changes

- [#131](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/131) [`828f52e`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/828f52eff1291629d73c3058173cff2fa60e3b28) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Uses configured Pi keybindings for ask navigation and theme-native TUI colors.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-reasoning-tool — 0.1.11

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add inline cache-hit predictions when switching Pi model or reasoning lanes.

  Warn once that automatic reasoning-level changes can cause prompt-cache misses and affect provider costs or quotas.

[Full changelog](./packages/pi-auto-reasoning-tool/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.11

### Changes

- [#184](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/184) [`18868c1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/18868c1ba0257f7d6ddeeb7dfc51f3af467e4633) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Use the configurable lightweight summary model for tree summaries. Clarify workflow, review-context, summary-session, and RPC protocol ownership.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add inline cache-hit predictions when switching Pi model or reasoning lanes.

  Warn once that automatic reasoning-level changes can cause prompt-cache misses and affect provider costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 3.0.6

### Changes

- [#216](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/216) [`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Makes realtime voice more conversational and robust with the Codex voice model, host-owned LAN WebRTC with seamless device takeover, buffered browser audio, buffered native playback, packet reordering, and loss concealment. Keeps voice alive across Pi model changes and avoids unnecessary transport resets when saving settings. Ships prompt schemas as raw Markdown with agent-assisted migration instead of rewriting custom prompts. Preserves full native compaction input until session usage exceeds the endpoint budget. Limits Pi documentation lookup to unresolved Pi API or runtime dependencies, and keeps the custom-tool guide focused on creating and editing definitions rather than discovering or calling tools. Bundles a disabled browser custom-tool example with local CDP control, bounded child output, safe screenshot paths, accurate load-all deadlines, and opt-in SSH routing. Rejects incompatible voice helpers immediately and preserves LAN startup errors through terminal cleanup.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-dynamic-tools — 0.0.8

### Changes

- [#195](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/195) [`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Correct Herdr delivery failures to acknowledge that messages may already be queued

[Full changelog](./packages/pi-dynamic-tools/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.13

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.46

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Makes realtime voice more conversational and robust with the Codex voice model, host-owned LAN WebRTC with seamless device takeover, buffered browser audio, buffered native playback, packet reordering, and loss concealment. Keeps voice alive across Pi model changes and avoids unnecessary transport resets when saving settings. Ships prompt schemas as raw Markdown with agent-assisted migration instead of rewriting custom prompts. Rejects incompatible voice helpers immediately and preserves LAN startup errors through terminal cleanup.

- Updated dependencies [[`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0)]:
  - @howaboua/pi-gippity-control@0.0.4

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.4

### Changes

- [#216](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/216) [`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Makes realtime voice more conversational and robust with the Codex voice model, host-owned LAN WebRTC with seamless device takeover, buffered browser audio, buffered native playback, packet reordering, and loss concealment. Keeps voice alive across Pi model changes and avoids unnecessary transport resets when saving settings. Ships prompt schemas as raw Markdown with agent-assisted migration instead of rewriting custom prompts. Rejects incompatible voice helpers immediately and preserves LAN startup errors through terminal cleanup.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.0

### Changes

- [#164](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/164) [`b8731f6`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b8731f68c8b6cbfb167e29728aad07fb59e560bb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add `/sol`, `/terra`, and `/luna` commands for switching GPT-5.6 Codex models and reasoning levels.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-markdown-workflows — 0.2.20

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make skill descriptions terse semantic indexes, remove purpose sections, and distinguish operational from creative body language.

[Full changelog](./packages/pi-markdown-workflows/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.4

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-memories/CHANGELOG.md)

### @howaboua/pi-semantic-grep — 0.1.18

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-semantic-grep/CHANGELOG.md)

### @howaboua/pi-skill-adversarial-qa — 0.0.1

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add the adversarial-qa skill for falsifying code behaviour with property, differential, mutation, and fuzz testing.

[Full changelog](./packages/pi-skill-adversarial-qa/CHANGELOG.md)

### @howaboua/pi-skill-agent-native-hardening — 0.0.6

### Changes

- [#166](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/166) [`5118fd9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5118fd9c29c050316a4fa1cf9122b501710e7056) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add execution-topology hardening guidance for agent-navigable call stacks and measured import, initialization, startup, and bundle performance.

[Full changelog](./packages/pi-skill-agent-native-hardening/CHANGELOG.md)

### @howaboua/pi-skill-agents-md — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make skill descriptions terse semantic indexes and remove redundant job restatements from operational bodies.

[Full changelog](./packages/pi-skill-agents-md/CHANGELOG.md)

### @howaboua/pi-skill-anti-ai-copy — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make skill descriptions terse semantic indexes and remove redundant job restatements from operational bodies.

[Full changelog](./packages/pi-skill-anti-ai-copy/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make skill descriptions terse semantic indexes and remove redundant job restatements from operational bodies.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-codex-prompt-caching — 0.0.1

### Changes

- [#214](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/214) [`2023aa0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2023aa005da4d32f9af0b9bc161c9224d8c60486) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add a Codex prompt-caching skill covering GPT-5.6 caching, Codex request continuity, Pi hooks, compaction, dynamic tools, measurement, and extension review.

[Full changelog](./packages/pi-skill-codex-prompt-caching/CHANGELOG.md)

### @howaboua/pi-skill-gh-issue-pr-flow — 0.0.7

### Changes

- [#168](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/168) [`70c9973`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/70c9973b8509d2ebefc26acef5c25d1e01b47d47) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Cull feature-existence and implementation-coupled tests before final PR submission, retaining only independently justified contract coverage.

[Full changelog](./packages/pi-skill-gh-issue-pr-flow/CHANGELOG.md)

### @howaboua/pi-skill-model-facing-api-design — 0.0.5

### Changes

- [#149](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/149) [`94b2252`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/94b225295be07e04206460963fd3da754a74565e) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Document model-facing punctuation and token-cost hygiene

[Full changelog](./packages/pi-skill-model-facing-api-design/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make skill descriptions terse semantic indexes and remove redundant job restatements from operational bodies.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skill-project-reference-research — 0.0.4

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make skill descriptions terse semantic indexes and remove redundant job restatements from operational bodies.

[Full changelog](./packages/pi-skill-project-reference-research/CHANGELOG.md)

### @howaboua/pi-skill-skill-creator — 0.0.5

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make skill descriptions terse semantic indexes, remove purpose sections, and distinguish operational from creative body language.

[Full changelog](./packages/pi-skill-skill-creator/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.14

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-codex-prompt-caching: Add a Codex prompt-caching skill covering GPT-5.6 caching, Codex request continuity, Pi hooks, compaction, dynamic tools, measurement, and extension review.

- Updated dependencies [[`2023aa0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2023aa005da4d32f9af0b9bc161c9224d8c60486)]:
  - @howaboua/pi-skill-codex-prompt-caching@0.0.1

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.5

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.49

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Makes realtime voice more conversational and robust with the Codex voice model, host-owned LAN WebRTC with seamless device takeover, buffered browser audio, buffered native playback, packet reordering, and loss concealment. Keeps voice alive across Pi model changes and avoids unnecessary transport resets when saving settings. Ships prompt schemas as raw Markdown with agent-assisted migration instead of rewriting custom prompts. Rejects incompatible voice helpers immediately and preserves LAN startup errors through terminal cleanup.

- Updated dependencies [[`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0)]:
  - @howaboua/pi-gippity-control@0.0.4

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.14

### Changes

- [#198](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/198) [`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Replace the review subprocess transport with Pi's maintained RPC client, preserve failed-run diagnostics, prevent review-loop bookkeeping from creating empty summaries, and reissue guidance for each fresh review loop

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.10

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

