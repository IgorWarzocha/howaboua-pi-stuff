# @howaboua/pi-auto-trees

## 0.1.13

### Changes

- [#269](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/269) [`6138ffd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6138ffd735bb4f7f80e451320dbfd0933a4acaa7) Thanks [@howaclawa](https://github.com/howaclawa)! - Expose a reusable realtime voice prompt API, report open ask prompts, Auto Trees navigation, Shepherdr worker settlements, and isolated review progress through it, announce context compaction as it starts, begin speaking Pi updates after two sentences and continue by paragraph, use compatible reasoning summaries only for otherwise silent tool steps without exposing Chat Completions thinking content, make spoken delegation acknowledgements configurable, display and deliver V3 delegations as soon as they are created, preserve delegations that arrive after an acknowledgement completes, resume established calls when the realtime data channel closes, keep spoken Pi updates conversational instead of repeating them line by line, preserve the prepared Code Mode prompt and single prewarm for voice-started Pi turns, preserve Codex cache continuity across voice delegation and compaction prewarming, and reduce LAN playback dropouts with one additional jitter-buffer frame.

## 0.1.12

### Changes

- [#235](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/235) [`5657b77`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5657b778f59ffa2eb86f10f7e949f060d95eb993) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in tree, review, and voice summaries, assemble complete multi-block delta-only RPC streaming updates, and remove retired Smart BTW shortcut-capture and voice helper exports

## 0.1.11

### Changes

- [#184](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/184) [`18868c1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/18868c1ba0257f7d6ddeeb7dfc51f3af467e4633) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Use the configurable lightweight summary model for tree summaries. Clarify workflow, review-context, summary-session, and RPC protocol ownership.

## 0.1.10

### Changes

- [#177](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/177) [`bf58bdc`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/bf58bdce157ca9c3c7869b629ad148bd05a3a100) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add /prime command with automatic settled-agent markers

## 0.1.9

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

## 0.1.8

### Changes

- [#77](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/77) [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Pins compatibility checks to Pi 0.80.6 and verifies current session, TUI, tool, and file-mutation APIs.

## 0.1.7

### Changes

- [#67](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/67) [`1a4302a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1a4302ad02a122480aeba29deacaa6f8925571ad) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.

## 0.1.6

### Changes

- [#42](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/42) [`f380d72`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f380d721c2fbd9956d730cae456aa7f38e4f0546) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Bumps Pi package peer and runtime dependencies to 0.79.0.

  Updates `@howaboua/pi-subagent-review` review messages so isolated findings are triaged as advisory input, not treated as automatic implementation work.

## 0.1.5

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Expose package-root extension entrypoints so aggregate extension packages can import dependency versions through normal package resolution.

## 0.1.4

### Changes

- [#11](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/11) [`78ac21f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/78ac21f443f2e14e00e0252b423b09182c31f0be) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Show temporary UI feedback while `/end` summarizes back to the marker.
