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

### @howaboua/pi-auto-reasoning-tool — 0.1.6

### Changes

- [#24](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/24) [`008e017`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/008e01742bad5d743d23f6f445d8defb04610ee3) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Restore reasoning to the current agent turn's starting level instead of reusing the first level captured after extension load.

[Full changelog](./packages/pi-auto-reasoning-tool/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.5

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 1.5.21

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add the model-facing-api-design skill package.

  Fix Codex context budget adjustment so starting fresh sessions does not recursively shrink a reused model's displayed context window.

  Add a Proxy tools override for proxied providers, enabled by default, so Codex proxy users can choose whether listed providers receive native web search, image generation, and fast mode.

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add a configurable Codex background shell widget for running exec sessions, and use Pi's Windows shell resolution for default Codex exec sessions.

  Preserve Windows shell invocation semantics for cmd.exe and PowerShell-backed exec sessions.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.8

### Changes

- [#28](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/28) [`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Persist only minimal explore subagent result metadata in parent sessions instead of the child subagent transcript.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.9

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows: Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.

- Updated dependencies [[`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc)]:
  - @howaboua/pi-markdown-workflows@0.2.13

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-markdown-workflows — 0.2.13

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.

[Full changelog](./packages/pi-markdown-workflows/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.1

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

[Full changelog](./packages/pi-memories/CHANGELOG.md)

### @howaboua/pi-semantic-grep — 0.1.12

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

[Full changelog](./packages/pi-semantic-grep/CHANGELOG.md)

### @howaboua/pi-skill-agent-native-hardening — 0.0.2

### Changes

- [#15](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/15) [`26d4e8b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/26d4e8b89fb050463bf5cf3486ba1fa0ba84d8b3) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Makes the agent native hardening skill language-agnostic and adds JavaScript/TypeScript-, Python-, Rust-, and Go-specific reference guidance.

[Full changelog](./packages/pi-skill-agent-native-hardening/CHANGELOG.md)

### @howaboua/pi-skill-agents-md — 0.0.1

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add the agents-md skill package.

[Full changelog](./packages/pi-skill-agents-md/CHANGELOG.md)

### @howaboua/pi-skill-anti-ai-copy — 0.0.1

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`f252da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f252da342444236f06c6da3f7d92cbdab420d770) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Initial public skill packages from the Howaboua Pi Stuff monorepo.

[Full changelog](./packages/pi-skill-anti-ai-copy/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.1

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`f252da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f252da342444236f06c6da3f7d92cbdab420d770) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Initial public skill packages from the Howaboua Pi Stuff monorepo.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-gh-issue-pr-flow — 0.0.3

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep sponsor-check status out of PR bodies and avoid reporting successful sponsor checks in final summaries.

[Full changelog](./packages/pi-skill-gh-issue-pr-flow/CHANGELOG.md)

### @howaboua/pi-skill-model-facing-api-design — 0.0.1

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add the model-facing-api-design skill package.

  Fix Codex context budget adjustment so starting fresh sessions does not recursively shrink a reused model's displayed context window.

  Add a Proxy tools override for proxied providers, enabled by default, so Codex proxy users can choose whether listed providers receive native web search, image generation, and fast mode.

[Full changelog](./packages/pi-skill-model-facing-api-design/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.1

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`f252da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f252da342444236f06c6da3f7d92cbdab420d770) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Initial public skill packages from the Howaboua Pi Stuff monorepo.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skill-project-reference-research — 0.0.1

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`f252da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f252da342444236f06c6da3f7d92cbdab420d770) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Initial public skill packages from the Howaboua Pi Stuff monorepo.

[Full changelog](./packages/pi-skill-project-reference-research/CHANGELOG.md)

### @howaboua/pi-skill-skill-creator — 0.0.2

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.

[Full changelog](./packages/pi-skill-skill-creator/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.7

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-agents-md: Add the agents-md skill package.
  - @howaboua/pi-skill-skill-creator: Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.
  - @howaboua/pi-skill-model-facing-api-design: Add the model-facing-api-design skill package. Fix Codex context budget adjustment so starting fresh sessions does not recursively shrink a reused model's displayed context window. Add a Proxy tools override for proxied providers, enabled by default, so Codex proxy users can choose whether listed providers receive native web search, image generation, and fast mode.

- Updated dependencies [[`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc), [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc), [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc)]:
  - @howaboua/pi-skill-model-facing-api-design@0.0.1
  - @howaboua/pi-skill-skill-creator@0.0.2
  - @howaboua/pi-skill-agents-md@0.0.1

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.0

### Changes

- [#22](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/22) [`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Multi-slot BTW sessions with JSONL restore, tombstones, inject-and-clear, and configurable alt shortcuts.

### Changes

- [#22](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/22) [`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fix review-loop marker placement so the advisory preface remains in history instead of being pasted into the prompt during loop summarization, send review findings as custom review messages in all paths, harden smart-btw slot bounds and answer handling, improve subdirectory context discovery from shell output, and remove a missing file from the skills aggregate package manifest.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.9

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows: Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.
  - @howaboua/pi-skill-agents-md: Add the agents-md skill package.
  - @howaboua/pi-skill-skill-creator: Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.
  - @howaboua/pi-skill-model-facing-api-design: Add the model-facing-api-design skill package. Fix Codex context budget adjustment so starting fresh sessions does not recursively shrink a reused model's displayed context window. Add a Proxy tools override for proxied providers, enabled by default, so Codex proxy users can choose whether listed providers receive native web search, image generation, and fast mode.

- Updated dependencies [[`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc), [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc), [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc)]:
  - @howaboua/pi-skill-model-facing-api-design@0.0.1
  - @howaboua/pi-skill-skill-creator@0.0.2
  - @howaboua/pi-markdown-workflows@0.2.13
  - @howaboua/pi-skill-agents-md@0.0.1

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.2

### Changes

- [#22](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/22) [`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fix review-loop marker placement so the advisory preface remains in history instead of being pasted into the prompt during loop summarization, send review findings as custom review messages in all paths, harden smart-btw slot bounds and answer handling, improve subdirectory context discovery from shell output, and remove a missing file from the skills aggregate package manifest.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.6

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

