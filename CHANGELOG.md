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

### @howaboua/pi-codex-conversion — 3.0.15

### Changes

- [#292](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/292) [`06aff78`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/06aff787778630394e122b89821c33f599d00bb2) Thanks [@howaclawa](https://github.com/howaclawa)! - Expand pi-codex-conversion with persistent Notebook Mode, true Fast Mode, project-owned settings, and current Pi/Codex protocol support.

  - **Notebook Mode:** Run Code Mode as a persistent Deno/TypeScript Jupyter kernel while keeping the same `exec` and `wait` workflow. Serializable state survives cells and restarts; deliberate bindings can be shared across project sessions, and agents discover and leave reusable project helpers without exposing private session scratch.
  - **Notebook operations:** Add named reusable profiles, inspect/pin/prune/reset/restart controls, one-shot Deno diagnostics, recoverable `.ipynb` journals, memory telemetry, expandable nested-tool traces, and conflict-aware concurrent project state.
  - **Notebook resilience:** Bound kernel cancellation, cleanup, wire messages, and journal retention; emit interoperable notebook cell IDs; reject malformed dependency inventories and conflict payloads before reading or deleting state.
  - **Safer notebook dependencies:** Require approval for new exact-version npm imports, show packages already available to the kernel, and lazily install verified Deno 2.9.5 builds on Linux, macOS, and Windows for x64 and ARM64.
  - **Real Fast Mode:** Activate ChatGPT Codex priority processing across WebSocket, SSE, prewarm, reconnect, retry, and native compaction while preserving ordinary request identity when Fast Mode is off. Renamed providers and monitoring proxies retain the appropriate Codex transport behavior.
  - **Project settings:** Let trusted projects switch `/codex` from global defaults to a complete `.pi/pi-codex-conversion.json` snapshot. Normal, Code, or Notebook execution persists in the selected scope, while independently launched workers can force Fast Mode without changing other Pi sessions. Retire the old `beta` settings bag by migrating its values to execution, OpenAI transport, and compaction settings.
  - **Models and tool contracts:** Add gated Daybreak Blue and Daybreak Red cybersecurity models, honor Pi's opt-in strict tool schemas, load deferred tools through native GPT-5.6 `additional_tools`, preserve terminal `end_turn`, and carry namespaced tool identities through stock, renamed, proxy, Code, and Notebook routes.
  - **Compatibility and security:** Require Pi 0.84.2 or newer and update Undici to patched 8.10.0.

- [#292](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/292) [`06aff78`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/06aff787778630394e122b89821c33f599d00bb2) Thanks [@howaclawa](https://github.com/howaclawa)! - Preserve canonical Codex subscription capabilities for provider aliases through their own credential scope without changing stock `openai-codex` transport behavior for custom endpoints. Honor Pi's configured `shellPath` in Code Mode execution and prompt context, with safer guidance for nested commands and zsh exit-status capture. Keep realtime voice prompts below the upstream per-item context limit without dropping content.

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

### @howaboua/pi-extensions — 0.0.58

### Changes

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Orchestrate Pi agents across named remote Herdr machines with automatic SSH bridge deployment and explicit reconnect controls.

- Updated dependencies [[`b20e7de`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b20e7de137fe89344bc15b06c7e7e0bf02a896b3)]:
  - @howaboua/pi-shepherdr@0.1.2

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.12

### Changes

- [#290](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/290) [`439c7f0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/439c7f05c5e5c8a1d8a69ae133167e56289af555) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Route `/gippity create` through Pi's ordinary user-prompt lifecycle while preserving its transcript card.
  - Condense settings details and show the effective LAN port.
  - Document custom web-app paths and port configuration.

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

### @howaboua/pi-stuff — 0.0.63

### Changes

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Orchestrate Pi agents across named remote Herdr machines with automatic SSH bridge deployment and explicit reconnect controls.

- Updated dependencies [[`b20e7de`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b20e7de137fe89344bc15b06c7e7e0bf02a896b3)]:
  - @howaboua/pi-shepherdr@0.1.2

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.16

### Changes

- [#269](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/269) [`6138ffd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6138ffd735bb4f7f80e451320dbfd0933a4acaa7) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
  - Announce compaction and stream conversational Pi updates after two sentences.
  - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
  - Configure delegation acknowledgements and deliver V3 delegations immediately.
  - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
  - Reduce LAN playback dropouts with one more jitter-buffer frame.

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

