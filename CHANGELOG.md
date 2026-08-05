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

### @howaboua/pi-codex-conversion — 3.0.8

### Changes

- [#223](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/223) [`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Seed realtime voice with a user-selected session context model and reasoning level, default context reasoning to high, summarize clean conversational text without reasoning or tool noise, show the exact startup summary in a display-only Voice Context entry, preserve native Responses checkpoints without sharing the main cache lane, give Pi non-triggering model-visible lifecycle guidance for spoken delegation progress and restore normal interaction on exit, regenerate context after an explicit voice restart while preserving sessions across device handoff, retain stopped-session transcript tails for fresh restarts, keep muted calls alive with silence RTP, show each finalized spoken user turn once without exposing partial recognition, route hidden clean delegation envelopes with deduplicated finalized frontend history, map clean Pi assistant messages to realtime commentary or speech at message boundaries, display completed voice replies once, and request delegation acknowledgement fillers explicitly.

  Guide Code Mode to reread files changed since their last read before patching them again.

  Avoid duplicating partial apply patch failures in Code Mode traces and result metadata.

  Guide generated commands to follow the detected shell's syntax, quoting, and variable rules.

  Tell agents to resume running exec cells and command sessions near expected completion instead of short polling.

  Resolve bare Bash requests through Pi's detected shell on Windows and prevent persisted terminal controls from reaching custom exec renderers.

  Identify the user-owned realtime system prompt by its default path in the migration changelog.

  Remove the redundant dimmed voice-context summary from both settings screens.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-dynamic-tools — 0.0.8

### Changes

- [#195](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/195) [`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Correct Herdr delivery failures to acknowledge that messages may already be queued

[Full changelog](./packages/pi-dynamic-tools/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.13

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.48

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Seed realtime voice with a user-selected session context model and reasoning level, default context reasoning to high, summarize clean conversational text without reasoning or tool noise, show the exact startup summary in a display-only Voice Context entry, preserve native Responses checkpoints without sharing the main cache lane, give Pi non-triggering model-visible lifecycle guidance for spoken delegation progress and restore normal interaction on exit, regenerate context after an explicit voice restart while preserving sessions across device handoff, retain stopped-session transcript tails for fresh restarts, keep muted calls alive with silence RTP, show each finalized spoken user turn once without exposing partial recognition, route hidden clean delegation envelopes with deduplicated finalized frontend history, map clean Pi assistant messages to realtime commentary or speech at message boundaries, display completed voice replies once, and request delegation acknowledgement fillers explicitly. Guide Code Mode to reread files changed since their last read before patching them again. Avoid duplicating partial apply patch failures in Code Mode traces and result metadata. Guide generated commands to follow the detected shell's syntax, quoting, and variable rules. Tell agents to resume running exec cells and command sessions near expected completion instead of short polling. Resolve bare Bash requests through Pi's detected shell on Windows and prevent persisted terminal controls from reaching custom exec renderers. Identify the user-owned realtime system prompt by its default path in the migration changelog. Remove the redundant dimmed voice-context summary from both settings screens.

- Updated dependencies [[`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1)]:
  - @howaboua/pi-gippity-control@0.0.6

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.6

### Changes

- [#223](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/223) [`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Seed realtime voice with a user-selected session context model and reasoning level, default context reasoning to high, summarize clean conversational text without reasoning or tool noise, show the exact startup summary in a display-only Voice Context entry, preserve native Responses checkpoints without sharing the main cache lane, give Pi non-triggering model-visible lifecycle guidance for spoken delegation progress and restore normal interaction on exit, regenerate context after an explicit voice restart while preserving sessions across device handoff, retain stopped-session transcript tails for fresh restarts, keep muted calls alive with silence RTP, show each finalized spoken user turn once without exposing partial recognition, route hidden clean delegation envelopes with deduplicated finalized frontend history, map clean Pi assistant messages to realtime commentary or speech at message boundaries, display completed voice replies once, and request delegation acknowledgement fillers explicitly.

  Guide Code Mode to reread files changed since their last read before patching them again.

  Avoid duplicating partial apply patch failures in Code Mode traces and result metadata.

  Guide generated commands to follow the detected shell's syntax, quoting, and variable rules.

  Tell agents to resume running exec cells and command sessions near expected completion instead of short polling.

  Resolve bare Bash requests through Pi's detected shell on Windows and prevent persisted terminal controls from reaching custom exec renderers.

  Identify the user-owned realtime system prompt by its default path in the migration changelog.

  Remove the redundant dimmed voice-context summary from both settings screens.

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

### @howaboua/pi-skill-gh-stack — 0.0.2

### Changes

- [#231](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/231) [`f05fa46`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f05fa469e034ec0e47f238f213437e5a11f2b13c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Improve the native GitHub stacked-PR skill with tested noninteractive command guidance, lazy-loaded command and recovery references, machine-readable state contracts, and issue-batch stack design.

[Full changelog](./packages/pi-skill-gh-stack/CHANGELOG.md)

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

### @howaboua/pi-skills — 0.0.16

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-gh-stack: Improve the native GitHub stacked-PR skill with tested noninteractive command guidance, lazy-loaded command and recovery references, machine-readable state contracts, and issue-batch stack design.

- Updated dependencies [[`f05fa46`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f05fa469e034ec0e47f238f213437e5a11f2b13c)]:
  - @howaboua/pi-skill-gh-stack@0.0.2

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.5

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.53

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-gh-stack: Improve the native GitHub stacked-PR skill with tested noninteractive command guidance, lazy-loaded command and recovery references, machine-readable state contracts, and issue-batch stack design.

- Updated dependencies [[`f05fa46`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f05fa469e034ec0e47f238f213437e5a11f2b13c)]:
  - @howaboua/pi-skill-gh-stack@0.0.2

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.14

### Changes

- [#198](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/198) [`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Replace the review subprocess transport with Pi's maintained RPC client, preserve failed-run diagnostics, prevent review-loop bookkeeping from creating empty summaries, and reissue guidance for each fresh review loop

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.10

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

