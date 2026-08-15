# @howaboua/pi-explore-subagents

## 0.1.13

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

## 0.1.12

### Changes

- [#79](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/79) [`dc0d253`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dc0d25382e1b650e024cc235e23ea62117784e23) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Uses GPT-5.6 Luna for shallow discovery and GPT-5.6 Terra for deep discovery by default.

## 0.1.11

### Changes

- [#77](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/77) [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Use Pi 0.80.6 `agent_settled` completion.
  - Accept maximum-thinking configurations.
  - Keep active subagent work free of wall-clock limits.

## 0.1.10

### Changes

- [#67](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/67) [`1a4302a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1a4302ad02a122480aeba29deacaa6f8925571ad) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.

## 0.1.9

### Changes

- [#42](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/42) [`f380d72`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f380d721c2fbd9956d730cae456aa7f38e4f0546) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Bump Pi peer and runtime dependencies to 0.79.0.
  - Treat isolated review findings as advisory input, not automatic implementation work.

## 0.1.8

### Changes

- [#28](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/28) [`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Persist only minimal explore subagent result metadata in parent sessions instead of the child subagent transcript.

## 0.1.7

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

## 0.1.6

### Changes

- [#11](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/11) [`78ac21f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/78ac21f443f2e14e00e0252b423b09182c31f0be) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Persist explore subagent config under the user agent directory, migrating existing package-local config on first use.

## 0.1.5

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`d57f0cb`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d57f0cbb5b92ce5cb7cf4736b6012c5ff0bebaae) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix TypeScript errors under the shared workspace typecheck settings.
