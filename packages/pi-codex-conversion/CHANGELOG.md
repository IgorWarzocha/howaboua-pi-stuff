# Changelog

## 3.0.8

### Changes

- [#223](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/223) [`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Seed realtime voice with a user-selected session context model and reasoning level, default context reasoning to high, summarize clean conversational text without reasoning or tool noise, show the exact startup summary in a display-only Voice Context entry, preserve native Responses checkpoints without sharing the main cache lane, give Pi non-triggering model-visible lifecycle guidance for spoken delegation progress and restore normal interaction on exit, regenerate context after an explicit voice restart while preserving sessions across device handoff, retain stopped-session transcript tails for fresh restarts, keep muted calls alive with silence RTP, show each finalized spoken user turn once without exposing partial recognition, route hidden clean delegation envelopes with deduplicated finalized frontend history, map clean Pi assistant messages to realtime commentary or speech at message boundaries, display completed voice replies once, and request delegation acknowledgement fillers explicitly.

  Guide Code Mode to reread files changed since their last read before patching them again.

  Avoid duplicating partial apply patch failures in Code Mode traces and result metadata.

  Guide generated commands to follow the detected shell's syntax, quoting, and variable rules.

  Tell agents to resume running exec cells and command sessions near expected completion instead of short polling.

  Resolve bare Bash requests through Pi's detected shell on Windows and prevent persisted terminal controls from reaching custom exec renderers.

  Identify the user-owned realtime system prompt by its default path in the migration changelog.

  Remove the redundant dimmed voice-context summary from both settings screens.

## 3.0.7

### Changes

- [#219](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/219) [`47bd29a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/47bd29a9b89bb3e2a8d50d4a7b3d84e981d8a34c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Render voice and dictation cards immediately without adding them to model context, carry conversation transcripts with actual delegations, preserve realtime audio cadence across coarse system timers, steer long Code Mode commands through exec/wait instead of session polling, and report repeated native compaction usage from the current checkpoint

## 3.0.6

### Changes

- [#216](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/216) [`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Makes realtime voice more conversational and robust with the Codex voice model, host-owned LAN WebRTC with seamless device takeover, buffered browser audio, buffered native playback, packet reordering, and loss concealment. Keeps voice alive across Pi model changes and avoids unnecessary transport resets when saving settings. Ships prompt schemas as raw Markdown with agent-assisted migration instead of rewriting custom prompts. Preserves full native compaction input until session usage exceeds the endpoint budget. Limits Pi documentation lookup to unresolved Pi API or runtime dependencies, and keeps the custom-tool guide focused on creating and editing definitions rather than discovering or calling tools. Bundles a disabled browser custom-tool example with local CDP control, bounded child output, safe screenshot paths, accurate load-all deadlines, and opt-in SSH routing. Rejects incompatible voice helpers immediately and preserves LAN startup errors through terminal cleanup.

## 3.0.5

### Changes

- [#212](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/212) [`a00d4ff`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a00d4ffa416feec7b799138424a2456b2b9d474c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep unfinished exec session polls bounded by host backoff, surface pending output, finalize exited processes despite retained handles, update the native PTY runner, preserve cross-platform paths in apply_patch results, refresh native image processing with safer validation, metadata-preserving re-encoding, and byte-bounded caching, route web_run search and navigation through Codex's native cached search endpoint, and validate imagegen edit inputs through Codex's current image pipeline.

- [#212](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/212) [`a00d4ff`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a00d4ffa416feec7b799138424a2456b2b9d474c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep new Code Mode custom tools out of the prompt until the session restarts or compacts

## 3.0.4

### Changes

- [#205](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/205) [`a7f4e55`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a7f4e55c7c3e0818dedf6c66d852e6153b026d28) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Align Codex transport recovery and cache continuation with Codex: separate request and stream failure lanes, honor bounded streamed delays and overload budgets, preserve turn state and WebSocket close codes, avoid caching unfinished responses, and isolate continuation state across sessions, models, reasoning levels, tool order, and compaction.

## 3.0.3

### Changes

- [#203](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/203) [`67f6fdf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/67f6fdf98dc3cc3c0349890b28f60aad1f7f3fac) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Capture final provider instructions after downstream prompt extensions so native Codex compaction reuses the active WebSocket cache. Cache settled collapsed exec previews by terminal width to prevent historical command output from consuming CPU on every TUI redraw.

## 3.0.2

### Changes

- [#200](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/200) [`744b0d5`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/744b0d532ccf2cb41d225b76c367a249debf4a2b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve Codex WebSocket cache continuations across Pi replay differences, prewarm fresh sockets with native compaction checkpoints, and block automatic full-context replay after a stream has already started.

## 3.0.1

### Changes

- [#198](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/198) [`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve Codex V2 cache continuations, recover mid-stream WebSocket failures through SSE retries, deliver realtime voice cards during active turns, add reconnect-safe realtime microphone mute controls, and turn native loader failures into concise local-build recovery guidance

## 3.0.0

### Breaking changes

- [#195](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/195) [`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make the native structured-tool adapter, Responses Lite Code Mode, settings, compaction, and voice features the canonical pi-codex-conversion implementation. This replaces legacy PATH mode and removes its package binaries; existing `pi-codex-conversion.json` settings continue to load. Add a configurable GipPity control-server shortcut and remove obsolete V2 conversation settings; realtime voice always uses V3 while dictation remains a separate action. Route Realtime delegations into active Pi turns as immediate steering and mirror direct Pi steering back to the owning voice delegation. Keep retries on WebSocket after mid-stream disconnects, route dictation through configured proxies on Node, recover the LAN remote when its upstream helper exits, and let cleared audio devices remain cleared. Preserve the active provider prompt during V2 compaction so prompt caches remain hot, pass V2 feature headers through prewarmed sockets, and reconcile tool calls with their outputs after every history rewrite. Refresh the disabled Herdr example and add a categorized lazy skill loader alongside the existing additive loader. Lite users should remove `@howaboua/pi-codex-conversion-lite` before installing the canonical package.

## 2.2.28

### Changes

- [#191](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/191) [`1605b4b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1605b4b9caaed055bbd9a0d8a72142b15af29a0f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Recover failed Codex WebSocket sessions through SSE until successful compaction restores cached WebSockets. Serialize patch mutations, retain partial patch errors, and accept model-style image paths

## 2.2.27

### Changes

- [#188](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/188) [`e9f30ea`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/e9f30ea4455057e4c32b697043b107a97bcbcf88) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep Codex WebSocket continuations alive through the backend cache window so delayed compaction can reuse the hot context.

## 2.2.26

### Changes

- [#186](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/186) [`b77e6d2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b77e6d2474cebdb91a1b8ab52ff69297c930b314) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Migrate legacy function-shaped exec history to native custom-tool IDs so existing Code Mode sessions resume across the tool-contract upgrade

## 2.2.25

### Changes

- [#184](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/184) [`18868c1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/18868c1ba0257f7d6ddeeb7dfc51f3af467e4633) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Clarify Code Mode tool exposition as configured tools change, limit ALL_TOOLS to deferred configured custom tools, add an opt-in heavy system prompt overwrite that preserves chained extension additions and refreshes cached transport state, install the Code Mode host correctly under Pi's Bun runtime, replay completed exec results on late polls with per-poll output caps, keep selected extra tools available in voice-only mode, support locally built Rust tool binaries across flat and Code Mode tools, preserve GPT-5.6 tool history up to the native compaction endpoint budget, report V2 compaction cache usage inline, and let Lite identify requests as pi-codex-conversion

## 2.2.24

### Changes

- [#179](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/179) [`ffa9c25`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ffa9c25f1cbe4e9a23b18a6122f468dc6e8a42e4) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Yield silent shell commands as sessions while active commands continue waiting. Encourage concise intermediary progress updates during longer realtime voice work

## 2.2.23

### Changes

- [#175](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/175) [`2e7c7e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2e7c7e90201a16b51215857b453d001cb3318605) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Use bounded raw PTY output instead of terminal emulation while preserving large pipe payloads and reporting omitted PTY output in token counts. Clarify safe JavaScript quoting for multiline Code Mode commands

## 2.2.22

### Changes

- [`620baba`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/620baba32dad1a1e3f70bf0cd30e4960584f52c4) - Keep web_run requests isolated to explicit search and navigation arguments instead of leaking conversation context into search answers.

## 2.2.21

### Changes

- [`3647fc2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3647fc296f4f5ea70c355f43b080383382f7b0d7) - Make published Codex extension artifacts reuse Pi's provider streams and verify packed extensions load before release.

## 2.2.20

### Changes

- [#168](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/168) [`70c9973`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/70c9973b8509d2ebefc26acef5c25d1e01b47d47) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add the lite Codex adapter with structured standard Responses tools, GPT-5.6 Responses Lite Code Mode, a routed and lazily loaded settings UI, shared config compatibility, native helpers, V2-only Responses compaction, and voice. Both Codex adapters now show active Code Mode executions immediately, keep non-TTY foreground commands attached, back off yielded shell sessions for up to 30 minutes, preserve transport policy during compaction and voice-only use, decode bounded terminal output across byte and control-sequence boundaries, and install the Code Mode host in-process so standalone Pi binaries work on Windows. Lite remains excluded from aggregate bundles and preserves full-adapter fields in the shared config.

## 2.2.19

### Changes

- [#162](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/162) [`d60c264`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d60c264b2044fd7282da0bc1b51caaa7a3e4471b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep dictation context notices to the first use until compaction, refresh device settings from disk before every voice start, and make audio-routing failures actionable for users and their Pi agent.

## 2.2.18

### Changes

- [#159](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/159) [`d0e4678`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d0e4678543703ec83f23381e2e52c79ce19ec61b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Resolve bundled voice helpers from the installed npm package layout.

## 2.2.17

### Changes

- [#157](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/157) [`2a8e979`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2a8e979b4d622244a0f58550f4141cfd3bad8f60) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add native Codex voice conversation and manually controlled dictation sessions, with configurable push/toggle shortcuts, persisted protocol, voice, and audio-device preferences, agent-guided device setup, cross-platform native capture and playback, Pi-agent delegation, themed session context, layered global and workspace realtime prompts, explicit lifecycle control, and a voice-only extension mode.

  Keep push-to-dictate tied to real key releases when available and key-repeat continuity in terminals that omit releases.

  Stop active voice sessions immediately from `/codex voice stop`, even while the main agent is working.

  Require Pi 0.82, keep voice-only mode from rewriting provider requests, honor provider proxy settings during realtime call setup, and validate and byte-bound native helper data and PCM events before buffering.

  Recover cached Codex WebSocket sessions when the backend loses their previous-response continuation.

  Clarify shell and Code Mode guidance so long-running commands remain interruptible and quote-heavy shell does not become invalid JavaScript.

  Load native voice transports and command-only usage networking only when used.

  Fix native web search on Windows by launching the bundled executable directly instead of spawning its command wrapper.

  Keep Rust build sources out of the installed npm package while retaining native binaries and third-party notices.

## 2.2.16

### Changes

- [#151](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/151) [`e1f44a2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/e1f44a25bbc850db6df285e9944c183ce0fbc7e5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Use UUIDv7 request IDs for sessionless OpenAI Codex WebSocket requests.

## 2.2.15

### Changes

- [#149](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/149) [`94b2252`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/94b225295be07e04206460963fd3da754a74565e) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Trim cosmetic terminal punctuation from model-facing Codex prompts and tool metadata; document raw `cmd` strings and JavaScript template-literal considerations; guide apply-patch hunk ordering and return clearer, trace-safe recovery errors

## 2.2.14

### Changes

- [#144](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/144) [`5fd1368`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5fd13686f185d21782db8839ae0d798d32163874) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve exec_command startup failures, recover confused process continuations, avoid duplicate nested image rendering, and align Code Mode command tools around forced per-tool yield times, project-local discovery, named configuration failures, and expanded bundled examples.

## 2.2.13

### Changes

- [#138](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/138) [`088be70`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/088be704fec1ad0d67461fab88f43822f6776bdb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Allows Responses compaction v1 and v2 to reuse the same encrypted checkpoint across protocol and model changes when the provider, API, and endpoint match. Native compaction now inherits the active model and reasoning level, while normal model switches preserve backend-verified WebSocket continuation.

## 2.2.12

### Changes

- [#136](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/136) [`a5a98cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a5a98cfe4a145e730b1b1bbfb91377ce1f066d35) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Aligns native OpenAI compaction with Codex v1 by compacting the full active transcript and preserving cached history prefixes during oversized-request trimming. Adds an opt-in Responses compaction v2 protocol that uses the active provider stream and cached WebSocket lifecycle while retaining recent real user messages beside the encrypted checkpoint. V2 retention can preserve 16k, 32k, or Codex-native 64k user-message windows without slicing messages. GPT-5.6 model windows are conservatively clamped to the current 272k production limit so Pi compacts before backend overflow. Running Code Mode cells and shell commands now identify the exact continuation call needed to resume them in their active tool mode, while repeated Code Mode waits back off locally to give long-running work time to finish. Code Mode also intercepts standalone shell-shaped `apply_patch` calls through the native nested patch tool, matching Codex's lenient invocation path without exposing another top-level schema.

## 2.2.11

### Changes

- [#134](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/134) [`a938fbd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a938fbdfb722d3e3105fb778538f4e3d9be954d3) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Restore Code Mode tool execution for configured OpenAI Responses providers on Pi 0.80.8 and newer by routing their streams through the custom-tool parser. Persist settings atomically and make existing Code Mode history safe to resume after the mode is disabled.

## 2.2.10

### Changes

- [#131](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/131) [`828f52e`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/828f52eff1291629d73c3058173cff2fa60e3b28) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Adds Pi 0.80.8 compatibility for Codex device login and review-session model runtime handling.

## 2.2.9

### Changes

- [#128](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/128) [`7bcf709`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7bcf709f700056cbc921bf597fd5ff0267f2706a) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Remove redundant tool-name labels from promoted Code Mode usage contracts.

## 2.2.8

### Changes

- [#124](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/124) [`556ac48`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/556ac482bad77fb8e76d9e218687ab10ad0d2f70) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Clarify Code Mode output and continuation tool guidance.

## 2.2.7

### Changes

- [#118](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/118) [`9b00dea`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/9b00deac82223f8a26c9c918c29e003fc03f0d25) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Scope cached OpenAI Codex WebSocket shutdown to the Pi session being closed so in-process sibling sessions keep their connections.

## 2.2.6

### Changes

- [#115](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/115) [`f6bf8d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f6bf8d953cbb2de661b628a311dcbbc01367b250) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Route Code Mode web search through explicitly configured Responses proxies using their active model and endpoint.

## 2.2.5

### Changes

- [#111](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/111) [`5cf7d6b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5cf7d6b3ef6769b884d3458e80baafcd9dce5648) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fix extension startup in Pi by using its modern root API factory instead of a runtime pi-ai subpath import.

## 2.2.4

### Changes

- [#109](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/109) [`cbe2950`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cbe295098ea5668102963ca9e27982864635eea7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Respect Pi skill exclusions by leaving native `.agents` skill discovery to Pi. Code Mode now prepares its V8 host early with proxy-aware, cancellable downloads, preserves raw exec calls and response diagnostics through explicitly configured Responses providers, supports header-only proxy authentication, separates optional proxy Responses Lite transport from Code Mode, and keeps its model-facing tool contract compact.

## 2.2.3

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Rewrite package documentation around current installation, configuration, usage, and behavior.

## 2.2.2

### Changes

- [#104](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/104) [`819bf9c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/819bf9c0a2f72a1d9131c50ebedafe354f67cf3f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve Codex prompt caches when extensions activate tools dynamically and pass through explicit tool choice on Pi 0.80.7.

## 2.2.1

### Changes

- [#100](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/100) [`14cfe97`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/14cfe97fcde447b9981d2ab755fcf65f1cc71ecf) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Let bundled Code Mode spawn agents inherit the parent Codex extension and active tool surface.

- [#100](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/100) [`14cfe97`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/14cfe97fcde447b9981d2ab755fcf65f1cc71ecf) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Restore GPT-5.6 Code Mode tools after Pi reloads extensions or switches sessions.

## 2.2.0

### Changes

- [#94](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/94) [`a820d16`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a820d161749acfa010b1212cef40cb51efa5e023) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add GPT-5.6 Code Mode with the Responses Lite transport, a freeform `exec` and `wait` surface, Codex-compatible nested patch/web/image tools, schema-free PATH tools, deferred custom TOML tools with bundled opt-in templates, and configurable Codex-style or detailed nested-tool rendering.

## 2.1.7

### Changes

- [#82](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/82) [`4b52058`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4b52058203bc119e1cd5b212d9fa7471a067d752) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Syncs the Codex provider with Pi 0.80.6 and uses GPT-5.6 Luna by default for web search, image descriptions, and native compaction. Adds the GPT-5.6 helper model choices, max reasoning, zstd SSE requests, current Responses usage accounting, session/thread identity, stale WebSocket rotation, prewarming and raw-item continuation, per-turn Codex sticky routing, validated opt-in Responses Lite for GPT-5.6 turns and native compaction, a provider sync checklist, and the current Codex apply-patch engine behind Pi's local-only filesystem and structured-output adapters. Keeps the background shell widget TUI-only so RPC sessions do not access an uninitialized terminal theme. Publishes a precompiled Node 22-compatible extension entrypoint, built by release automation, and lazily initializes optional parsers/tokenizers to reduce Pi startup time. Splits extension registration, runtime lifecycle, tools, events, and UI into owned modules and tightens provider adapter contracts. Resolves compaction context and explicit reasoning limits from the configured compaction model rather than the active chat model.

## 2.1.6

### Changes

- [#69](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/69) [`8b8ddb4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b8ddb47812a6033b01f66e5442f282b4dc84d44) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fixes PATH-mode apply_patch previews with trailing shell commands and keeps PATH web_run/imagegen commands on the long wait path.

- [#69](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/69) [`8b8ddb4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b8ddb47812a6033b01f66e5442f282b4dc84d44) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Updates the Codex provider compatibility pass for Pi 0.80.1.

## 2.1.5

### Changes

- [#65](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/65) [`47351f8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/47351f85c22e6b9e32ff6929e8cb63f4431473a2) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep native Responses compaction scoped to OpenAI Codex and explicitly configured providers when the adapter is enabled for all models.

## 2.1.4

### Changes

- [#63](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/63) [`80ca67c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/80ca67c5a2131b10d4bbb5a642e04e95fda547da) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Use OpenAI Codex subscription auth for Codex-backed web and image tools on all models, route image generation through the Codex image endpoints, add optional image descriptions for text-only models, shrink oversized tool outputs before native Responses compaction, fix PATH apply_patch Ctrl+O expansion, add a compact tools setting for collapsed patch summaries, avoid rereading generated image files during UI rendering, warn when a local checkout is behind npm, and show local-build guidance for incompatible bundled exec_bridge binaries.

## 2.1.3

### Changes

- [#60](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/60) [`6de2278`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6de22781a8c449ccf193fcd66773754b08facfe7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Bounds collapsed exec_command previews for large outputs and adds an all-models extras-only mode with per-tool overlays for apply_patch, view_image, web_run, and imagegen.

## 2.1.2

### Changes

- [#56](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/56) [`cd98303`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cd983037da3344ce7790af09f873d2b82799ea55) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fix collapsed exec rendering for errored tool results without structured output details.

## 2.1.1

### Changes

- [#53](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/53) [`4c2e803`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4c2e803f3cc9d9fe7daa0e54f4548af536c8b472) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Use OpenAI Codex subscription auth for Codex-backed web and image tools on all models, route image generation through the Codex image endpoints, and add optional image descriptions for text-only models.

## 2.1.0

### Changes

- [#50](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/50) [`a9bbba8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a9bbba894a04bc43b4af9e31d68bd3323617b1b8) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add Codex reset-credit count and Ctrl+R reset action in the Usage tab.

  Theme the Codex adapter status label with Pi's active accent color and dim the status details.

  Show collapsed shell output previews and capped patch diffs, including PATH-mode `apply_patch` previews and native-style PATH tool call labels inside `exec_command`.

  Preserve raw shell behavior for PATH tool pipelines/redirections and use the active `exec_command` workdir for PATH `apply_patch` previews.

  Keep segmented PATH `apply_patch` rendering after failures while showing the actual shell error output instead of an optimistic diff preview.

  Surface captured `exec_bridge` startup stderr in `exec_command` failures.

  Document building bundled Codex tools from a Git checkout for older Linux compatibility.

  Update Pi development dependencies to 0.79.4, match Pi's Codex SSE timeout, and stop shrinking Codex model context windows.

## 2.0.1

### Changes

- [#42](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/42) [`f380d72`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f380d721c2fbd9956d730cae456aa7f38e4f0546) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Ignore non-Responses thinking signatures when converting Codex context so Anthropic signatures do not crash JSON parsing.

## 2.0.0

### Breaking changes

- [#40](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/40) [`62a18db`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/62a18dbd99346e76e77e610bbde2912854a4365b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Reworks Codex conversion around bundled Rust tool execution and adds a PATH mode.

  - Adds bundled cross-platform Rust binaries for `exec_command`, `write_stdin`, `apply_patch`, `view_image`, `web_run`, and `imagegen`.
  - Removes `node-pty` dependency.
  - Runs the toolkit through bundled binaries - very likely to help with stability - the tools will crash, but not Pi itself. Also improves maintainability - one implementation for all the tools/modes.
  - Adds PATH mode: Pi only exposes `exec_command` and `write_stdin` as JSON-schema tools, while `apply_patch`, `view_image`, `web_run`, and `imagegen` are available as shell commands on an extension-injected internal PATH (no changes to user PATH settings).
  - Tweaks to system prompt and JSON schema tool definitions to trim a few tokens here and there.
  - Reworks grouped `/codex` settings tabs for General, Tools, OpenAI, Usage, and About, including tool-rendering controls, PATH mode, web search model selection, fast mode, verbosity, cached WebSocket upgrade, native compaction settings, and usage display. Removes the confusing “apply patch for all GPT” switch; proxied providers should be named in scope instead.
  - Moves the native OAI compaction out of beta.

## 1.5.21

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add the model-facing-api-design skill package.

  Fix Codex context budget adjustment so starting fresh sessions does not recursively shrink a reused model's displayed context window.

  Add a Proxy tools override for proxied providers, enabled by default, so Codex proxy users can choose whether listed providers receive native web search, image generation, and fast mode.

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add a configurable Codex background shell widget for running exec sessions, and use Pi's Windows shell resolution for default Codex exec sessions.

  Preserve Windows shell invocation semantics for cmd.exe and PowerShell-backed exec sessions.

## 1.5.20

### Changes

- [#30](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/30) [`645baa1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/645baa16a2661d04964d5c9409830836a3405ead) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Match Codex background terminal polling by allowing empty `write_stdin` waits to use a dedicated 5-minute cap instead of the normal 30-second exec cap.

## 1.5.19

### Changes

- [#28](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/28) [`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve Codex WebSocket continuation across parallel tool-output replay drift and keep native web-search response items in Responses history for stable follow-up replay.

- [#28](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/28) [`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Adds an `adapterProviders` setting for enabling the Codex adapter on named custom providers.

## 1.5.18

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Align the custom OpenAI Codex provider with Pi 0.77 and 0.78 Responses fixes for explicit API-key handling, SSE abort cleanup, and fallback replay message IDs.

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Update Codex settings links to point at the monorepo package.

## 1.5.17

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`d57f0cb`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d57f0cbb5b92ce5cb7cf4736b6012c5ff0bebaae) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Fix TypeScript errors under the shared workspace typecheck settings.

## 1.5.16

- Aligned OpenAI Codex custom-provider cache-affinity headers, timeout handling, reasoning effort options, Bun proxy WebSocket support, and development dependencies with Pi 0.76.
- Kept the extension's intentional hidden Codex provider retry behavior unchanged.

## 1.5.14-1.5.15

- Preserved cached WebSocket continuation reuse for OpenAI Codex requests when only the reasoning level changes.
- Added a Codex provider setting that upgrades explicit WebSocket transport to cached WebSocket transport without changing Pi's global transport preference or disabling `auto` SSE fallback behavior.
- Verified the cached WebSocket reasoning-change path against the live Codex provider with request-shape diagnostics enabled.
- Replaced cached WebSocket request-shape logging with a deterministic continuation-reuse test.

## 1.5.13

- Relaxed native compaction replay parity so the extension preserves the OpenAI compacted window using Pi's current provider payload when persisted session replay shape diverges.

## 1.5.12

- Hardened native Responses compaction replay after Pi fallback or compacted-window shape changes, preserving the previous native compacted window without aborting normal requests.
- Scoped native compacted-window injection to Pi compaction recovery requests so stale fallback state cannot leak into ordinary Responses requests.
- Improved compaction warnings for provider switching and recovery from failed native compaction.

## 1.5.11

- Aligned the custom OpenAI Codex provider and Pi development dependencies with Pi 0.75.4.
- Added Codex context-budget alignment so Pi auto-compaction for OpenAI Codex subscription models triggers near Codex's native 90% compacting threshold.
- Improved native Responses compaction fallback: failed native compactions now fall back to Pi compaction, and reuse the previous native compacted window when available.
- Pruned low-value compatibility tests while keeping focused coverage for adapter activation, native tools, compaction fallback, and Codex context budgeting.

## 1.5.10

- Added `/codex usage` and a Usage tab for OpenAI Codex subscription limits, with automatic refresh and aligned 5-hour/weekly usage columns.
- Moved settings links into a dedicated About tab.

## 1.5.9

- Fixed native Responses compaction replay when provider payloads include in-flight tail items that are not yet persisted in the session branch.

## 1.5.8

- Fixed native Responses compaction replay after compaction display messages so requests replace Pi placeholder compaction context with the native compacted window instead of failing parity checks.

## 1.5.7

- Fixed OpenAI Codex custom-provider requests so synthetic `web.run` and `image_generation` adapter tools are rewritten to native Responses tool payloads before sending.
- Fixed subagent and other RPC/no-session Codex runs failing with invalid function tool names when native web search is active.

## 1.5.6

- Added Compaction and Overrides tabs to `/codex`.
- Added optional native Responses compaction for Codex sessions, with settings for compaction model and reasoning.
- Added an `apply_patch`-only override mode for GPT/Codex models. This mode bypasses most of this extension, but still gives you the `apply_patch` tool.
- Renamed the native Codex web search tool from `web_search` to responses-native `web.run`, allowing compatibility with other extensions.
- Synced the custom OpenAI Codex provider and Pi development dependencies with Pi `0.75.3`.

## 1.5.5

- Avoid registering disabled native `web_search` and `image_generation` tools so other extensions can own those names.
- Preserve other extensions' `web_search` and `image_generation` tools when the matching Codex feature is off.
- Added a `/codex status` toggle and settings UI option for hiding the Codex footer/statusline.

## 1.5.4

- Added `/codex` settings UI.
- Added saved global config at `~/.pi/agent/pi-codex-conversion.json`.
- Added toggles for fast mode, native web search, native image generation, and using the adapter on all models.
- Added verbosity control for Responses API providers.
- Added footer status details for active Codex settings.
- Added quick links from the settings UI to GitHub, Discord, and issue filing.
- Updated Pi development dependencies to 0.74.1.

## 1.5.3

- Improved exploration output for skill reads so `SKILL.md` activity is easier to understand.

## 1.5.2

- Streamed partial `exec_command` updates while commands are still running.
- Improved background terminal responsiveness and display state.

## 1.5.1

- Cleaned up the Codex adapter prompt and tool surface.
- Fixed skill prompt injection after reload.
- Fixed adapter tool restore behavior when switching models.
- Simplified tool descriptions and README wording.
- Bundled `apply_patch` and moved publishing to GitHub Actions.

## 1.5.0

- Aligned the Codex provider with Pi 0.73 and Pi 0.74 package/API changes.
- Updated package scope for the Earendil Pi packages.
- Removed a noisy web search startup note.

## 1.0.29

- Aligned with Pi 0.72.
- Fixed cached websocket transport behavior.
- Fixed thinking-level mapping and runtime compatibility issues.

## 1.0.28

- Aligned with Pi 0.70.5 Codex provider changes.

## 1.0.27

- Marked Codex websocket failures as retryable connection errors.

## 1.0.26

- Retried stale Codex websocket reuse.

## 1.0.25

- Sanitized Codex image generation history before sending follow-up requests.

## 1.0.24

- Updated the adapter for Pi 0.70 compatibility.
- Fixed Codex websocket close race handling.

## 1.0.23

- Hotfix to remove a stale Codex max token field.

## 1.0.22

- Hotfix to omit unsupported Codex max output tokens.

## 1.0.21

- Hardened Codex provider streaming and image handling.
- Preserved Codex image generation calls in conversation history.
- Aligned websocket client behavior with Pi's Codex provider.
- Future-proofed GPT-5 reasoning effort clamping.

## 1.0.20

- Updated for Pi 0.69 typebox changes.
- Replicated Pi Codex websocket transport handling.
- Fixed Codex SSE parsing, websocket auth, stream indexing, and websocket caching.
- Moved image path guidance into prompt/tool text.
- Hardened runtime behavior and activity ordering.

## 1.0.19

- Added native Codex web search and image generation support.
- Fixed Codex custom provider packaging and session handling.
- Restored Pi's default shell renderer for `apply_patch`.

## 1.0.18

- Aligned the extension with Pi 0.67.3 APIs.
- Fixed `prepareArguments` validation regressions.

## 1.0.17

- Improved `apply_patch` fuzzy matching safety.
- Continued applying independent patch actions after file failures.
- Blocked dependent patch actions after earlier failures.
- Tightened delete matching and path canonicalization.
- Improved section-anchor matching and partial move failure reporting.

## 1.0.12

- Added structured `apply_patch` recovery hints.
- Improved `apply_patch` failure rendering.
- Capped exec session buffers at 256 MiB.

## 1.0.11

- Hotfix to show `apply_patch` failures after arguments complete.
- Hotfix to hide incomplete `apply_patch` previews.

## 1.0.10

- Rendered partial `apply_patch` failures inline.
- Added PTY polling guardrails for `write_stdin`.
- Clamped tiny `exec_command` waits for non-interactive runs.
- Clarified `write_stdin` polling behavior in the README.

## 1.0.9

- Initial public release of the Codex-style Pi adapter.
- Added Codex-style shell tools, resumable exec sessions, patch editing, and tool rendering.
- Forced bash when Pi is launched under fish while preserving fish-derived `PATH`.
