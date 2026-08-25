# @howaboua/pi-gippity-control

## 0.0.16

### Changes

- [#349](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/349) [`ef7656c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ef7656c2aab3d2aa1cff581bae26dc9b102aece7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Restore live Pi speech by streaming visible progress, speaking enabled completed reasoning summaries, and integrating successive updates without replacing active speech.

## 0.0.15

### Changes

- [#346](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/346) [`bf42276`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/bf42276a2fdc10e41ce0d3f48855607ff89e50c8) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Speak Pi progress and final results as soon as they reach realtime voice instead of waiting for turn completion.

## 0.0.14

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Keep GipPity voice responsive across typed Pi turns and active speech. Speak one meaningful progress update, serialize final results, preserve interruptions, defer queued follow-up context until its Pi turn begins, resume dropped calls through the dedicated recovery owner, keep LAN certificate startup compatible with asynchronous generation, and keep package changelogs disabled with the extension in Pi config.

## 0.0.13

### Changes

- [#304](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/304) [`4b4e42f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4b4e42f7659e42854ec81cb502bf69a48422d9eb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Run Pi Pet as a first-class GipPity companion.

  - Meet Clawa through the browser, voice, desktop dictation, a transparent desktop window, or the headless pet-state feed.
  - Import compatible Codex and ChatGPT pets or author new pets through free-form `/pet` requests.
  - Keep authored pets and generated displays in durable Pi agent storage, with optional per-repository pet selection.
  - Attach the local device directly or remote devices through Pi-owned SSH sessions, with each folder remembering where its sessions appear.
  - Get exact install and reload guidance when GipPity Control is missing or outdated.

## 0.0.12

### Changes

- [#290](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/290) [`439c7f0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/439c7f05c5e5c8a1d8a69ae133167e56289af555) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Route `/gippity create` through Pi's ordinary user-prompt lifecycle while preserving its transcript card.
  - Condense settings details and show the effective LAN port.
  - Document custom web-app paths and port configuration.

## 0.0.11

### Changes

- [#286](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/286) [`0e4e876`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/0e4e87648c8612253b3e0758652077f1c8f4ef57) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Allow the LAN control server port to be set through lan.port and keep discovery available while a custom app is incomplete.

## 0.0.10

### Changes

- [#283](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/283) [`adfe989`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/adfe989598cab149c483a595e0108f917b7c40fa) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Add hosted custom remote apps and guided frontend creation.
  - Provide a browser client with agent-readable discovery.
  - Stream Pi events and generic Pi/context RPC through bounded realtime context frames.

## 0.0.9

### Changes

- [#263](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/263) [`85b0a1f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/85b0a1f3f22a4e6f8c98211fefe8388c3be39d29) Thanks [@howaclawa](https://github.com/howaclawa)!:

  - Follow system audio defaults unless an endpoint is pinned.
  - Keep successfully rerouted output streams active.
  - Share guided first-run and manual audio setup.

- [#268](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/268) [`df747db`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/df747dbc74520d11f7e56e3d85e2df81f5facba2) Thanks [@howaclawa](https://github.com/howaclawa)!:

  - Show voice-context summarization progress.
  - Greet users through the V3 speakable context channel when realtime sessions are ready.
  - Warn in Pi and the LAN controller when microphone input is too quiet.

- [#269](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/269) [`6138ffd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6138ffd735bb4f7f80e451320dbfd0933a4acaa7) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
  - Announce compaction and stream conversational Pi updates after two sentences.
  - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
  - Configure delegation acknowledgements and deliver V3 delegations immediately.
  - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
  - Reduce LAN playback dropouts with one more jitter-buffer frame.

## 0.0.8

### Changes

- [#253](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/253) [`c9fcbf8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c9fcbf8a44adff914ed8c4a86703a35d503e4b0b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add opt-in dropped realtime voice call auto-resume to GipPity Control and update Undici to its patched release.

## 0.0.7

### Changes

- [#235](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/235) [`5657b77`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5657b778f59ffa2eb86f10f7e949f060d95eb993) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in summaries.
  - Assemble complete multi-block, delta-only RPC streaming updates.
  - Remove retired Smart BTW shortcut-capture and voice-helper exports.

## 0.0.6

### Changes

- [#223](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/223) [`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Seed realtime voice with the selected session context model and reasoning level, using clean conversational summaries.
  - Show the startup summary in a display-only Voice Context entry and preserve native Responses checkpoints without sharing the main cache lane.
  - Guide spoken delegation lifecycle and restore normal interaction after exit or restart, including device handoff.
  - Retain stopped-session transcript tails, keep muted calls alive, and show finalized spoken turns once without partial recognition.
  - Route clean delegation envelopes with deduplicated history and map assistant messages to realtime commentary or speech at message boundaries.
  - Display completed voice replies once and request delegation acknowledgement fillers.
  - Tighten Code Mode, shell, session-resumption, Windows, prompt-path, and voice-context guidance.

## 0.0.5

### Changes

- [#219](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/219) [`47bd29a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/47bd29a9b89bb3e2a8d50d4a7b3d84e981d8a34c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Render voice and dictation cards immediately without adding them to model context.
  - Carry conversation transcripts with actual delegations and preserve realtime audio cadence across coarse timers.
  - Steer long Code Mode commands through exec/wait and report repeated native compaction usage.

## 0.0.4

### Changes

- [#216](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/216) [`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make realtime voice more conversational with Codex voice, host-owned LAN WebRTC, device takeover, buffering, packet reordering, and loss concealment.
  - Keep voice alive across Pi model changes and avoid unnecessary transport resets when saving settings.
  - Ship prompt schemas as raw Markdown with agent-assisted migration.
  - Reject incompatible voice helpers immediately and preserve LAN startup errors through cleanup.

## 0.0.3

### Changes

- [#198](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/198) [`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add reconnect-safe realtime microphone mute controls and native input gating

## 0.0.2

### Changes

- [#195](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/195) [`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add standalone GipPity voice and LAN control for any Pi model, including synchronized steering between active Pi and Realtime turns.
  - Recover the browser when its upstream helper exits, serialize shutdown cleanup, support configured proxies on Node, and declare the required Node runtime.
