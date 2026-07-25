# @howaboua/pi-codex-conversion-lite

## 0.1.2

### Changes

- [`2bfaf4c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2bfaf4c7bc1f847b5e155747cc0774843792fef7) - Prevent native dynamic imports from escaping Pi's loader aliases and verify every packed lazy module can load.

## 0.1.1

### Changes

- [`3647fc2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3647fc296f4f5ea70c355f43b080383382f7b0d7) - Make published Codex extension artifacts reuse Pi's provider streams and verify packed extensions load before release.

## 0.1.0

### Changes

- [#168](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/168) [`70c9973`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/70c9973b8509d2ebefc26acef5c25d1e01b47d47) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add the lite Codex adapter with structured standard Responses tools, GPT-5.6 Responses Lite Code Mode, a routed and lazily loaded settings UI, shared config compatibility, native helpers, V2-only Responses compaction, and voice. Both Codex adapters now show active Code Mode executions immediately, keep non-TTY foreground commands attached, back off yielded shell sessions for up to 30 minutes, preserve transport policy during compaction and voice-only use, decode bounded terminal output across byte and control-sequence boundaries, and install the Code Mode host in-process so standalone Pi binaries work on Windows. Lite remains excluded from aggregate bundles and preserves full-adapter fields in the shared config.

## 0.0.1

- Created the parallel-development package scaffold.
