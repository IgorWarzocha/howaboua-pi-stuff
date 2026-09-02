# @howaboua/pi-shepherdr

## 0.1.3

- Replaced Shepherdr's fire-and-forget tool with persistent blocking and asynchronous agents in normal Pi, Code Mode, and Notebook Mode.

  - Start, steer, inspect, and answer multiple agents through the `agents` tool.
  - Customize the bundled general, explorer, and reviewer profiles or add your own.
  - Activate orchestration mode with `/herdr` when the main session should coordinate agent work.

## 0.1.2

### Changes

- [#298](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/298) [`b20e7de`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b20e7de137fe89344bc15b06c7e7e0bf02a896b3) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Orchestrate Pi agents across named remote Herdr machines with automatic SSH bridge deployment and explicit reconnect controls.

## 0.1.1

### Changes

- [#269](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/269) [`6138ffd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6138ffd735bb4f7f80e451320dbfd0933a4acaa7) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
  - Announce compaction and stream conversational Pi updates after two sentences.
  - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
  - Configure delegation acknowledgements and deliver V3 delegations immediately.
  - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
  - Reduce LAN playback dropouts with one more jitter-buffer frame.

## 0.1.0

### Changes

- [#256](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/256) [`4d306ed`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4d306eded0057c82868a1628bd2131a7eedfd7a6) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add Shepherdr, a Herdr-native Pi agent orchestrator with event-driven monitoring and a live fleet widget.
