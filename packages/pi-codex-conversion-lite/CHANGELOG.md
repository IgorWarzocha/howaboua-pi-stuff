# @howaboua/pi-codex-conversion-lite

## 0.1.7

### Changes

- [#186](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/186) [`b77e6d2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b77e6d2474cebdb91a1b8ab52ff69297c930b314) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Migrate legacy function-shaped exec history to native custom-tool IDs so existing Code Mode sessions resume across the tool-contract upgrade

## 0.1.6

### Changes

- [#184](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/184) [`18868c1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/18868c1ba0257f7d6ddeeb7dfc51f3af467e4633) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Clarify Code Mode tool exposition as configured tools change, limit ALL_TOOLS to deferred configured custom tools, add an opt-in heavy system prompt overwrite that preserves chained extension additions and refreshes cached transport state, install the Code Mode host correctly under Pi's Bun runtime, replay completed exec results on late polls with per-poll output caps, keep selected extra tools available in voice-only mode, support locally built Rust tool binaries across flat and Code Mode tools, preserve GPT-5.6 tool history up to the native compaction endpoint budget, report V2 compaction cache usage inline, and let Lite identify requests as pi-codex-conversion

## 0.1.5

### Changes

- [#179](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/179) [`ffa9c25`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ffa9c25f1cbe4e9a23b18a6122f468dc6e8a42e4) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Yield silent shell commands as sessions while active commands continue waiting. Encourage concise intermediary progress updates during longer realtime voice work

## 0.1.4

### Changes

- [#175](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/175) [`2e7c7e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2e7c7e90201a16b51215857b453d001cb3318605) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Use bounded raw PTY output instead of terminal emulation while preserving large pipe payloads and reporting omitted PTY output in token counts. Clarify safe JavaScript quoting for multiline Code Mode commands

## 0.1.3

### Changes

- [`620baba`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/620baba32dad1a1e3f70bf0cd30e4960584f52c4) - Keep web_run requests isolated to explicit search and navigation arguments instead of leaking conversation context into search answers.

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
