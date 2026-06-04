# @howaboua/pi-extensions

## 0.0.9

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows: Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.

- Updated dependencies [[`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc)]:
  - @howaboua/pi-markdown-workflows@0.2.13

## 0.0.8

### Changes

- Include bundled package updates:

  - @howaboua/pi-explore-subagents: Persist only minimal explore subagent result metadata in parent sessions instead of the child subagent transcript.

- Updated dependencies [[`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1)]:
  - @howaboua/pi-explore-subagents@0.1.8

## 0.0.7

### Changes

- Include bundled package updates:

  - @howaboua/pi-auto-reasoning-tool: Restore reasoning to the current agent turn's starting level instead of reusing the first level captured after extension load.

- Updated dependencies [[`008e017`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/008e01742bad5d743d23f6f445d8defb04610ee3)]:
  - @howaboua/pi-auto-reasoning-tool@0.1.6

## 0.0.6

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Fix review-loop marker placement so the advisory preface remains in history instead of being pasted into the prompt during loop summarization, send review findings as custom review messages in all paths, harden smart-btw slot bounds and answer handling, improve subdirectory context discovery from shell output, and remove a missing file from the skills aggregate package manifest.
  - @howaboua/pi-markdown-workflows: Fix review-loop marker placement so the advisory preface remains in history instead of being pasted into the prompt during loop summarization, send review findings as custom review messages in all paths, harden smart-btw slot bounds and answer handling, improve subdirectory context discovery from shell output, and remove a missing file from the skills aggregate package manifest.
  - @howaboua/pi-smart-btw: Multi-slot BTW sessions with JSONL restore, tombstones, inject-and-clear, and configurable alt shortcuts.

- Updated dependencies [[`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2), [`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2)]:
  - @howaboua/pi-subagent-review@0.2.2
  - @howaboua/pi-smart-btw@0.2.0
  - @howaboua/pi-markdown-workflows@0.2.12

## 0.0.5

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Load aggregate extension entries through package-local shims so dependency resolution prefers the aggregate package's own installed dependency versions.

- Updated dependencies [[`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9), [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9), [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9)]:
  - @howaboua/pi-markdown-workflows@0.2.11
  - @howaboua/pi-auto-trees@0.1.5
  - @howaboua/pi-explore-subagents@0.1.7
  - @howaboua/pi-memories@0.1.1
  - @howaboua/pi-semantic-grep@0.1.12
  - @howaboua/pi-smart-btw@0.1.3
  - @howaboua/pi-subagent-review@0.2.1
  - @howaboua/pi-vent@0.2.6

## 0.0.4

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Add `/review loop` markers that summarize completed review-fix increments before the next review pass.

- Updated dependencies [[`26d4e8b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/26d4e8b89fb050463bf5cf3486ba1fa0ba84d8b3)]:
  - @howaboua/pi-subagent-review@0.2.0

## 0.0.3

### Changes

- `@howaboua/pi-explore-subagents` now stores configuration in the user agent directory and migrates existing package-local config on first use.
- `@howaboua/pi-auto-trees` now shows temporary `/end` progress feedback while summarising back to the marker.

### Updated bundled packages

- `@howaboua/pi-explore-subagents@0.1.6`
- `@howaboua/pi-auto-trees@0.1.4`

## 0.0.2

### Changes

- [#6](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/6) [`e793612`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/e793612fb32a4f7e418f5d28772e6de75a5c26ad) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fix aggregate package resource paths so Pi can load installed dependency extensions and skills.

## 0.0.1

### Changes

- [`3c8c222`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3c8c2222bb8d907a85517dd2155f8ea77d2441fb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Initial public release from the Howaboua Pi Stuff monorepo.

- Updated dependencies [[`3c8c222`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3c8c2222bb8d907a85517dd2155f8ea77d2441fb), [`d57f0cb`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d57f0cbb5b92ce5cb7cf4736b6012c5ff0bebaae), [`9a7890b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/9a7890b63c7a9fb5be8ab2bdd16c41e78017a5b9)]:
  - @howaboua/pi-memories@0.1.0
  - @howaboua/pi-explore-subagents@0.1.5
  - @howaboua/pi-markdown-workflows@0.2.10
  - @howaboua/pi-semantic-grep@0.1.11
  - @howaboua/pi-smart-btw@0.1.2
  - @howaboua/pi-subagent-review@0.1.53
  - @howaboua/pi-vent@0.2.5
