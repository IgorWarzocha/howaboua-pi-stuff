# @howaboua/pi-markdown-workflows

## 0.2.20

### Changes

- [#126](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/126) [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make skill descriptions terse semantic indexes.
  - Remove redundant purpose or job restatements.
  - Distinguish operational from creative body language where applicable.

## 0.2.19

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Load nested AGENTS.md context from successful pi-codex Code Mode tool traces.

## 0.2.18

### Changes

- [#92](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/92) [`68ceda7`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/68ceda7ee01203df93d181cd940dc1b64d93739d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add a JSON `toolRegistration` setting that can hide the agent tool while keeping the rest of each extension active.

## 0.2.17

### Changes

- [#77](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/77) [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Pins compatibility checks to Pi 0.80.6 and verifies current session, TUI, tool, and file-mutation APIs.

## 0.2.16

### Changes

- [#72](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/72) [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Refine standalone and bundled skill-creation guidance.
  - Harden the checker with Pi limits and supporting-file suggestions.

## 0.2.15

### Changes

- [#67](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/67) [`1a4302a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1a4302ad02a122480aeba29deacaa6f8925571ad) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.

## 0.2.14

### Changes

- [#42](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/42) [`f380d72`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f380d721c2fbd9956d730cae456aa7f38e4f0546) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Bump Pi peer and runtime dependencies to 0.79.0.
  - Treat isolated review findings as advisory input, not automatic implementation work.

## 0.2.13

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.

## 0.2.12

### Changes

- [#22](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/22) [`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Keep the review-loop advisory preface in history during summarization.
  - Send review findings as custom review messages on every path.
  - Harden Smart BTW slot bounds and answer handling.
  - Improve subdirectory context discovery from shell output.
  - Remove the missing file from the skills aggregate manifest.

## 0.2.11

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix nested AGENTS.md tool-result loading so context stays out of model-level context, dedupes during active turns, and detects more read/discovery command paths.

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix nested AGENTS.md autoloading for shell discovery output and chained shell separators.

## 0.2.10

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`d57f0cb`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d57f0cbb5b92ce5cb7cf4736b6012c5ff0bebaae) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix TypeScript errors under the shared workspace typecheck settings.

- [`9a7890b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/9a7890b63c7a9fb5be8ab2bdd16c41e78017a5b9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make the bundled skill-creator skill less tied to local personal workflow language.
