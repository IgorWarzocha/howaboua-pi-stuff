# @howaboua/pi-extensions

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
