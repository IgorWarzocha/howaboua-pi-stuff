# @howaboua/pi-gippity-control

## 0.0.8

### Changes

- [#253](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/253) [`c9fcbf8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c9fcbf8a44adff914ed8c4a86703a35d503e4b0b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add opt-in dropped realtime voice call auto-resume to GipPity Control and update Undici to its patched release.

## 0.0.7

### Changes

- [#235](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/235) [`5657b77`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5657b778f59ffa2eb86f10f7e949f060d95eb993) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in tree, review, and voice summaries, assemble complete multi-block delta-only RPC streaming updates, and remove retired Smart BTW shortcut-capture and voice helper exports

## 0.0.6

### Changes

- [#223](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/223) [`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Seed realtime voice with a user-selected session context model and reasoning level, default context reasoning to high, summarize clean conversational text without reasoning or tool noise, show the exact startup summary in a display-only Voice Context entry, preserve native Responses checkpoints without sharing the main cache lane, give Pi non-triggering model-visible lifecycle guidance for spoken delegation progress and restore normal interaction on exit, regenerate context after an explicit voice restart while preserving sessions across device handoff, retain stopped-session transcript tails for fresh restarts, keep muted calls alive with silence RTP, show each finalized spoken user turn once without exposing partial recognition, route hidden clean delegation envelopes with deduplicated finalized frontend history, map clean Pi assistant messages to realtime commentary or speech at message boundaries, display completed voice replies once, and request delegation acknowledgement fillers explicitly.

  Guide Code Mode to reread files changed since their last read before patching them again.

  Avoid duplicating partial apply patch failures in Code Mode traces and result metadata.

  Guide generated commands to follow the detected shell's syntax, quoting, and variable rules.

  Tell agents to resume running exec cells and command sessions near expected completion instead of short polling.

  Resolve bare Bash requests through Pi's detected shell on Windows and prevent persisted terminal controls from reaching custom exec renderers.

  Identify the user-owned realtime system prompt by its default path in the migration changelog.

  Remove the redundant dimmed voice-context summary from both settings screens.

## 0.0.5

### Changes

- [#219](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/219) [`47bd29a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/47bd29a9b89bb3e2a8d50d4a7b3d84e981d8a34c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Render voice and dictation cards immediately without adding them to model context, carry conversation transcripts with actual delegations, preserve realtime audio cadence across coarse system timers, steer long Code Mode commands through exec/wait instead of session polling, and report repeated native compaction usage from the current checkpoint

## 0.0.4

### Changes

- [#216](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/216) [`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Makes realtime voice more conversational and robust with the Codex voice model, host-owned LAN WebRTC with seamless device takeover, buffered browser audio, buffered native playback, packet reordering, and loss concealment. Keeps voice alive across Pi model changes and avoids unnecessary transport resets when saving settings. Ships prompt schemas as raw Markdown with agent-assisted migration instead of rewriting custom prompts. Rejects incompatible voice helpers immediately and preserves LAN startup errors through terminal cleanup.

## 0.0.3

### Changes

- [#198](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/198) [`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add reconnect-safe realtime microphone mute controls and native input gating

## 0.0.2

### Changes

- [#195](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/195) [`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add standalone GipPity voice and LAN control for any Pi model, including synchronized steering between active Pi and Realtime turns. Recover the browser when its upstream helper exits, serialize shutdown cleanup, support configured proxies on Node, and declare the required Node runtime.
