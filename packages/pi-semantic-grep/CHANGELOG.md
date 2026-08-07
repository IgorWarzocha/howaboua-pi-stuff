# @howaboua/pi-semantic-grep

## 0.1.19

### Changes

- [#239](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/239) [`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make semantic indexing non-blocking at session startup, single-writer, atomic, resumable, ignore-aware, metadata-fast, batch-embedded, and role-aware while preserving usable prior file indexes across interrupted rebuilds.

## 0.1.18

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

## 0.1.17

### Changes

- [#92](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/92) [`68ceda7`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/68ceda7ee01203df93d181cd940dc1b64d93739d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add a JSON `toolRegistration` setting that can hide the agent tool while keeping the rest of each extension active.

## 0.1.16

### Changes

- [#77](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/77) [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Compiles against Pi 0.80.6 extension and renderer types without local module shims and cleans up indexing state on shutdown.

## 0.1.15

### Changes

- [#67](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/67) [`1a4302a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1a4302ad02a122480aeba29deacaa6f8925571ad) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.

## 0.1.14

### Changes

- [#47](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/47) [`f0aeb2a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f0aeb2ae53397a4adfd084911a8ef201dcf5d89e) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Streams semantic search rows from SQLite and keeps only the best matches in memory, avoiding heap exhaustion on large indexes.

## 0.1.13

### Changes

- [#42](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/42) [`f380d72`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f380d721c2fbd9956d730cae456aa7f38e4f0546) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Bumps Pi package peer and runtime dependencies to 0.79.0.

  Updates `@howaboua/pi-subagent-review` review messages so isolated findings are triaged as advisory input, not treated as automatic implementation work.

## 0.1.12

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

## 0.1.11

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`d57f0cb`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d57f0cbb5b92ce5cb7cf4736b6012c5ff0bebaae) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fix TypeScript errors under the shared workspace typecheck settings.
