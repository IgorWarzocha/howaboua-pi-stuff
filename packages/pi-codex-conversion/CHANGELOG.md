# Changelog

## 3.0.23

### Changes

- [#352](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/352) [`4e2b773`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4e2b773f8e069f4b61316bccc859faafe3451b9c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep installed Codex startup and prompt-cache keepalive reliable.

  - Load the package changelog from shipped JavaScript so the extension starts correctly from `node_modules`.
  - Replace the generic keepalive experiment with bounded global Luna windows and a project-only 25-minute Sol/Terra policy.
  - Refresh prompt caches independently from cached WebSocket continuation and retention.
  - Preserve first-party Codex behavior through renamed and proxied Codex routes, and clean isolated keepalive sockets on transport reset.

## 3.0.22

### Changes

- [#349](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/349) [`ef7656c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ef7656c2aab3d2aa1cff581bae26dc9b102aece7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Restore live Pi speech by streaming visible progress, speaking enabled completed reasoning summaries, and integrating successive updates without replacing active speech.

## 3.0.21

### Changes

- [#346](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/346) [`bf42276`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/bf42276a2fdc10e41ce0d3f48855607ff89e50c8) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Speak Pi progress and final results as soon as they reach realtime voice instead of waiting for turn completion.

## 3.0.20

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Keep realtime voice responsive across typed Pi turns, active speech, and compaction. Speak one meaningful progress update, serialize final results, and queue delegations until native compaction and prewarm finish.

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Make Code and Notebook Mode failures actionable and easier to recover.

  - Surface Deno syntax diagnostics instead of generic execution failures and isolate bridge networking from user bindings.
  - Encode action-specific notebook control inputs and return targeted recovery for persistent binding redeclarations.
  - Clarify safe shell interpolation, terminal input, and Deno tool composition in model-facing guidance.
  - Keep concurrent Code and Notebook sessions from taking optional Git index locks during read-only commands.
  - Retry idempotent browser reads after delayed Chrome responses without blaming debugger approval, while warning against blind retries of timed-out page mutations.
  - Return unambiguous tab references, prevent stale element aliases, support common ARIA menu controls, bound reference screenshots, validate browser references and pagination, serialize shared daemon state, release remote object handles, revalidate the requested control immediately before a native click, keep linked CLI entries executable, and expose the complete reference workflow in launcher help.
  - Focus and verify the identity of referenced editable fields without first dispatching a potentially consequential click.
  - Keep the Agents custom tool self-contained and remove the superseded Herdr Agent example.
  - Let the Skills custom tool load one or more routed references directly by name.
  - Preserve explicit `models.json` endpoints when installing the custom Codex transport and Daybreak model catalog.
  - Keep package changelogs disabled with the Codex extension in Pi config.
  - Keep LAN voice certificate startup compatible with asynchronous certificate generation.
  - Release queued realtime delegations when native compaction fails, is aborted, or any post-compaction step errors.
  - Defer queued Pi follow-up context until that follow-up begins its realtime handoff.

## 3.0.19

### Changes

- [#339](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/339) [`ee0220c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ee0220cdc44cd732dff9caf0c913e098ed14404f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep long Codex sessions cached through idle periods by generating and discarding an isolated completion over the complete settled context every 25 minutes. Resume transport from the complete current branch instead of a system-only baseline, and add named diagnostics with socket, continuation, and authoritative refresh usage.

- [#339](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/339) [`ee0220c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ee0220cdc44cd732dff9caf0c913e098ed14404f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve native compaction cache continuity after switching Codex models.

## 3.0.18

### Changes

- [#331](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/331) [`6b42bb6`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6b42bb6cb878b0bee860016a2698e4bb9351ced5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Allow native OpenAI Codex compaction requests up to the 872k subscription context budget without truncating tool outputs.

## 3.0.17

### Changes

- [#329](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/329) [`1d91df3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1d91df3f605a557958500bb40d14be576306f3a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep idle Codex cache refreshes on the exact provider request that produced the active cache, every 25 minutes, without disturbing the live WebSocket continuation or presenting `generate:false` usage as cache telemetry.

## 3.0.16

### Changes

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Expose `createApplyPatchTool` and an `apply-patch-display` integration API for custom patch views without changing the agent-facing `apply_patch` execution contract

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Preserve final configured Responses instructions for native replay

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Add a project-only experimental Codex cache keepalive that refreshes idle WebSocket context and reports cache-read results.

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make safe Notebook lifecycle controls callable from inside Notebook exec cells.

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Report native compaction cache misses with replay and transport diagnostics

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Recover interrupted Notebook kernels without deleting durable project bindings

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Make durable Notebook Mode globals discoverable and guide safe reuse with bounded descriptions and usage hints

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Keep oversized Responses V2 user turns out of the retained compaction window

- [#325](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/325) [`8b3c1e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b3c1e941309236efbf4b6f5157dd5352f1ec742) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)! - Prevent delayed background shell widget renders from using stale session contexts

## 3.0.15

### Changes

- [#292](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/292) [`06aff78`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/06aff787778630394e122b89821c33f599d00bb2) Thanks [@howaclawa](https://github.com/howaclawa)! - Expand pi-codex-conversion with persistent Notebook Mode, true Fast Mode, project-owned settings, and current Pi/Codex protocol support.

  - **Notebook Mode:** Run Code Mode as a persistent Deno/TypeScript Jupyter kernel while keeping the same `exec` and `wait` workflow. Serializable state survives cells and restarts; deliberate bindings can be shared across project sessions, and agents discover and leave reusable project helpers without exposing private session scratch.
  - **Notebook operations:** Add named reusable profiles, inspect/pin/prune/reset/restart controls, one-shot Deno diagnostics, recoverable `.ipynb` journals, memory telemetry, expandable nested-tool traces, and conflict-aware concurrent project state.
  - **Notebook resilience:** Bound kernel cancellation, cleanup, wire messages, and journal retention; emit interoperable notebook cell IDs; reject malformed dependency inventories and conflict payloads before reading or deleting state.
  - **Safer notebook dependencies:** Require approval for new exact-version npm imports, show packages already available to the kernel, and lazily install verified Deno 2.9.5 builds on Linux, macOS, and Windows for x64 and ARM64.
  - **Real Fast Mode:** Activate ChatGPT Codex priority processing across WebSocket, SSE, prewarm, reconnect, retry, and native compaction while preserving ordinary request identity when Fast Mode is off. Renamed providers and monitoring proxies retain the appropriate Codex transport behavior.
  - **Project settings:** Let trusted projects switch `/codex` from global defaults to a complete `.pi/pi-codex-conversion.json` snapshot. Normal, Code, or Notebook execution persists in the selected scope, while independently launched workers can force Fast Mode without changing other Pi sessions. Retire the old `beta` settings bag by migrating its values to execution, OpenAI transport, and compaction settings.
  - **Models and tool contracts:** Add gated Daybreak Blue and Daybreak Red cybersecurity models, honor Pi's opt-in strict tool schemas, load deferred tools through native GPT-5.6 `additional_tools`, preserve terminal `end_turn`, and carry namespaced tool identities through stock, renamed, proxy, Code, and Notebook routes.
  - **Compatibility and security:** Require Pi 0.84.2 or newer and update Undici to patched 8.10.0.

- [#292](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/292) [`06aff78`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/06aff787778630394e122b89821c33f599d00bb2) Thanks [@howaclawa](https://github.com/howaclawa)! - Preserve canonical Codex subscription capabilities for provider aliases through their own credential scope without changing stock `openai-codex` transport behavior for custom endpoints. Honor Pi's configured `shellPath` in Code Mode execution and prompt context, with safer guidance for nested commands and zsh exit-status capture. Keep realtime voice prompts below the upstream per-item context limit without dropping content.

## 3.0.14

### Changes

- [#273](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/273) [`d0dbb06`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d0dbb0619d9bd3bc965c2e17ae15f9fe9acfdc81) Thanks [@howaclawa](https://github.com/howaclawa)!:

  - Show the exact provider code when OpenAI blocks a Codex request without identifying the reason.

- [#270](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/270) [`d7dbad4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d7dbad4e6827d7ec61f3e7949cd60ca2875d9856) Thanks [@howaclawa](https://github.com/howaclawa)!:

  - Await exec process-group termination and graceful bridge exit during shutdown.
  - Contain wedged descendants and reject work after shutdown begins.

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

- [#264](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/264) [`6f24d07`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6f24d07224f806aad9213bfcb351e626d077116a) Thanks [@howaclawa](https://github.com/howaclawa)!:
  - Show remaining weekly Codex subscription usage in the adapter statusline.
  - Poll only for canonical ChatGPT subscription auth.
  - Preserve cached usage across failed or superseded refreshes.

## 3.0.13

### Changes

- [#253](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/253) [`c9fcbf8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c9fcbf8a44adff914ed8c4a86703a35d503e4b0b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Auto-resume dropped realtime voice calls when enabled.
  - Update Undici to its patched release.

## 3.0.12

### Changes

- [#248](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/248) [`4f9282e`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4f9282e9b502ef573bb894d849a7a490b39a3149) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve provider history across WebSocket replacement and native compaction.
  - Prevent cancelled prewarms from blocking replacements.
  - Keep interrupted partial tool calls from hiding abort status.

## 3.0.11

### Changes

- [#246](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/246) [`712f662`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/712f66216996aa37664f791f12b940611f30c7a2) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add cross-extension nested-tool preflights and keep native compaction displays out of turn queues.
  - Document exec output, preserve Codex errors for context-overflow recovery, and stop settled subagents hanging at shutdown.

## 3.0.10

### Changes

- [#239](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/239) [`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Render delete-and-readd patches as file edits.
  - Clarify move-file syntax.
  - Keep failed-patch recovery concise and non-duplicated.

- [#239](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/239) [`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make indexing non-blocking at session startup.
  - Use a single writer with atomic, resumable rebuilds.
  - Respect ignore rules and prioritize metadata, batching, and roles.
  - Preserve usable prior indexes across interrupted rebuilds.

## 3.0.9

### Changes

- [#235](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/235) [`5657b77`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5657b778f59ffa2eb86f10f7e949f060d95eb993) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Prepare realtime voice delegations before agent turns and preserve failed delegations without stale voice state.
  - Handle authentication, prewarming, shutdown, and Pi delivery failures while preserving cache continuity across compaction races.
  - Add opt-in live cache status and redacted per-session diagnostics.
  - Preserve extension prompt content, nested-tool rendering, user-facing citations, and duplicate-image protections.
  - Support Pi 0.84 route-scoped sockets, nullable headers, credential-resolved endpoints, cancellable subscription OAuth, and incomplete-response recovery.
  - Isolate voice preflight, transport recovery, exec lifecycle, and Responses history ownership.
  - Remove retired parser and internal compatibility shims.

## 3.0.8

### Changes

- [#223](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/223) [`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Seed realtime voice with the selected session context model and reasoning level, using clean conversational summaries.
  - Show the startup summary in a display-only Voice Context entry and preserve native Responses checkpoints without sharing the main cache lane.
  - Guide spoken delegation lifecycle and restore normal interaction after exit or restart, including device handoff.
  - Retain stopped-session transcript tails, keep muted calls alive, and show finalized spoken turns once without partial recognition.
  - Route clean delegation envelopes with deduplicated history and map assistant messages to realtime commentary or speech at message boundaries.
  - Display completed voice replies once and request delegation acknowledgement fillers.
  - Tighten Code Mode, shell, session-resumption, Windows, prompt-path, and voice-context guidance.

## 3.0.7

### Changes

- [#219](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/219) [`47bd29a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/47bd29a9b89bb3e2a8d50d4a7b3d84e981d8a34c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Render voice and dictation cards immediately without adding them to model context.
  - Carry conversation transcripts with actual delegations and preserve realtime audio cadence across coarse timers.
  - Steer long Code Mode commands through exec/wait and report repeated native compaction usage.

## 3.0.6

### Changes

- [#216](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/216) [`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make realtime voice more conversational with Codex voice, host-owned LAN WebRTC, device takeover, buffering, packet reordering, and loss concealment.
  - Keep voice alive across Pi model changes and avoid unnecessary transport resets when saving settings.
  - Ship prompt schemas as raw Markdown with agent-assisted migration.
  - Reject incompatible voice helpers immediately and preserve LAN startup errors through cleanup.

## 3.0.5

### Changes

- [#212](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/212) [`a00d4ff`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a00d4ffa416feec7b799138424a2456b2b9d474c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Bound unfinished exec polls with host backoff, surface pending output, finalize exited processes, and update the native PTY runner.
  - Preserve cross-platform apply-patch paths and refresh native image processing with safer validation, metadata preservation, and byte-bounded caching.
  - Route web search through Codex's cached endpoint and validate imagegen edits through the current image pipeline.

- [#212](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/212) [`a00d4ff`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a00d4ffa416feec7b799138424a2456b2b9d474c) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Keep new Code Mode custom tools out of the prompt until the session restarts or compacts

## 3.0.4

### Changes

- [#205](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/205) [`a7f4e55`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a7f4e55c7c3e0818dedf6c66d852e6153b026d28) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Align transport recovery and cache continuation with Codex's separate request and stream failure lanes.
  - Honor bounded streamed delays and overload budgets while preserving turn state and WebSocket close codes.
  - Avoid caching unfinished responses and isolate continuation state across sessions, models, reasoning levels, tool order, and compaction.

## 3.0.3

### Changes

- [#203](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/203) [`67f6fdf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/67f6fdf98dc3cc3c0349890b28f60aad1f7f3fac) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Capture final provider instructions after prompt extensions so native compaction reuses the active WebSocket cache.
  - Cache settled collapsed exec previews by terminal width.

## 3.0.2

### Changes

- [#200](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/200) [`744b0d5`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/744b0d532ccf2cb41d225b76c367a249debf4a2b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve Codex WebSocket cache continuations across Pi replay differences.
  - Prewarm fresh sockets with native compaction checkpoints and block full-context replay after streaming starts.

## 3.0.1

### Changes

- [#198](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/198) [`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve Codex V2 cache continuations and recover mid-stream WebSocket failures through SSE retries.
  - Deliver realtime voice cards during active turns and add reconnect-safe microphone mute controls.
  - Turn native loader failures into concise local-build recovery guidance.

## 3.0.0

### Breaking changes

- [#195](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/195) [`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make the native structured-tool adapter, Responses Lite Code Mode, settings, compaction, and voice the canonical implementation.
  - Replace legacy PATH mode and remove its package binaries while preserving existing settings.
  - Route realtime voice delegations into active Pi turns and mirror direct steering back to their owners.
  - Keep WebSocket retries, proxy-aware dictation, LAN recovery, and cleared audio devices across V2 history rewrites.
  - Refresh the Herdr example and add categorized lazy skill loading.
  - Keep the active provider prompt and feature headers through V2 compaction.
  - Require Lite users to remove the Lite package before installing the canonical package.

## 2.2.28

### Changes

- [#191](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/191) [`1605b4b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1605b4b9caaed055bbd9a0d8a72142b15af29a0f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Recover failed Codex WebSocket sessions through SSE until compaction restores cached sockets.
  - Serialize patch mutations, retain partial patch errors, and accept model-style image paths.

## 2.2.27

### Changes

- [#188](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/188) [`e9f30ea`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/e9f30ea4455057e4c32b697043b107a97bcbcf88) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Keep Codex WebSocket continuations alive through the backend cache window so delayed compaction can reuse the hot context.

## 2.2.26

### Changes

- [#186](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/186) [`b77e6d2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b77e6d2474cebdb91a1b8ab52ff69297c930b314) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Migrate legacy function-shaped exec history to native custom-tool IDs so existing Code Mode sessions resume across the tool-contract upgrade

## 2.2.25

### Changes

- [#184](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/184) [`18868c1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/18868c1ba0257f7d6ddeeb7dfc51f3af467e4633) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Clarify Code Mode tool exposure as configured tools change and limit `ALL_TOOLS` to deferred custom tools.
  - Add an opt-in prompt overwrite that preserves chained extensions and refreshes cached transport state.
  - Install the Code Mode host correctly under Bun and replay completed exec results with per-poll output caps.
  - Keep selected extra tools in voice-only mode and support locally built Rust binaries.
  - Preserve GPT-5.6 history to the compaction budget, report V2 cache usage, and identify Lite requests.

## 2.2.24

### Changes

- [#179](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/179) [`ffa9c25`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ffa9c25f1cbe4e9a23b18a6122f468dc6e8a42e4) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Yield silent shell commands as sessions while active commands continue waiting.
  - Encourage concise progress updates during longer realtime voice work.

## 2.2.23

### Changes

- [#175](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/175) [`2e7c7e9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2e7c7e90201a16b51215857b453d001cb3318605) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Use bounded raw PTY output while preserving large pipe payloads and reporting omitted output in token counts.
  - Clarify safe JavaScript quoting for multiline Code Mode commands.

## 2.2.22

### Changes

- [`620baba`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/620baba32dad1a1e3f70bf0cd30e4960584f52c4):
  - Keep web_run requests isolated to explicit search and navigation arguments instead of leaking conversation context into search answers.

## 2.2.21

### Changes

- [`3647fc2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3647fc296f4f5ea70c355f43b080383382f7b0d7):
  - Make published Codex extension artifacts reuse Pi's provider streams and verify packed extensions load before release.

## 2.2.20

### Changes

- [#168](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/168) [`70c9973`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/70c9973b8509d2ebefc26acef5c25d1e01b47d47) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add the Lite Codex adapter with structured Responses tools, GPT-5.6 Code Mode, routed settings, shared config, native helpers, compaction, and voice.
  - Show active Code Mode executions immediately, keep foreground commands attached, and back off yielded shell sessions.
  - Preserve transport policy, decode bounded terminal output, and install the Code Mode host in-process on Windows.
  - Keep Lite out of aggregate bundles while preserving full-adapter config fields.

## 2.2.19

### Changes

- [#162](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/162) [`d60c264`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d60c264b2044fd7282da0bc1b51caaa7a3e4471b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show dictation context notices only on first use until compaction.
  - Refresh device settings before every voice start.
  - Make audio-routing failures actionable for users and their agent.

## 2.2.18

### Changes

- [#159](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/159) [`d0e4678`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d0e4678543703ec83f23381e2e52c79ce19ec61b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Resolve bundled voice helpers from the installed npm package layout.

## 2.2.17

### Changes

- [#157](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/157) [`2a8e979`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2a8e979b4d622244a0f58550f4141cfd3bad8f60) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add native Codex voice conversation and manually controlled dictation with configurable shortcuts, persisted preferences, and guided setup.
  - Support cross-platform capture, playback, Pi delegation, themed context, layered prompts, lifecycle control, and voice-only mode.
  - Keep push-to-dictate tied to key releases, stop sessions immediately, and validate bounded native audio data.
  - Recover cached Codex sockets and clarify interruptible shell and Code Mode guidance.
  - Load optional voice transports and networking lazily, fix Windows web search, and keep Rust sources out of the npm package.

## 2.2.16

### Changes

- [#151](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/151) [`e1f44a2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/e1f44a25bbc850db6df285e9944c183ce0fbc7e5) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Use UUIDv7 request IDs for sessionless OpenAI Codex WebSocket requests.

## 2.2.15

### Changes

- [#149](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/149) [`94b2252`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/94b225295be07e04206460963fd3da754a74565e) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Trim cosmetic punctuation from model-facing prompts and tool metadata.
  - Document raw `cmd` strings and JavaScript template-literal considerations.
  - Guide apply-patch hunk ordering and return clearer recovery errors.

## 2.2.14

### Changes

- [#144](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/144) [`5fd1368`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5fd13686f185d21782db8839ae0d798d32163874) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve exec_command startup failures and recover confused process continuations.
  - Avoid duplicate nested image rendering.
  - Align Code Mode commands with forced yield times, project-local discovery, named configuration failures, and bundled examples.

## 2.2.13

### Changes

- [#138](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/138) [`088be70`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/088be704fec1ad0d67461fab88f43822f6776bdb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Reuse encrypted compaction checkpoints across matching provider, API, endpoint, protocol, and model changes.
  - Inherit the active model and reasoning level while preserving backend-verified WebSocket continuation.

## 2.2.12

### Changes

- [#136](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/136) [`a5a98cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a5a98cfe4a145e730b1b1bbfb91377ce1f066d35) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Aligns native OpenAI compaction with Codex v1 by compacting the full active transcript and preserving cached history prefixes during oversized-request trimming.
  - Adds an opt-in Responses compaction v2 protocol that uses the active provider stream and cached WebSocket lifecycle while retaining recent real user messages beside the encrypted checkpoint.
  - V2 retention can preserve 16k, 32k, or Codex-native 64k user-message windows without slicing messages.
  - GPT-5.6 model windows are conservatively clamped to the current 272k production limit so Pi compacts before backend overflow.
  - Running Code Mode cells and shell commands now identify the exact continuation call needed to resume them in their active tool mode, while repeated Code Mode waits back off locally to give long-running work time to finish.
  - Code Mode also intercepts standalone shell-shaped `apply_patch` calls through the native nested patch tool, matching Codex's lenient invocation path without exposing another top-level schema.

## 2.2.11

### Changes

- [#134](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/134) [`a938fbd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a938fbdfb722d3e3105fb778538f4e3d9be954d3) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Restore Code Mode execution for configured OpenAI Responses providers on Pi 0.80.8+.
  - Persist settings atomically and make existing Code Mode history safe to resume when disabled.

## 2.2.10

### Changes

- [#131](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/131) [`828f52e`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/828f52eff1291629d73c3058173cff2fa60e3b28) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Adds Pi 0.80.8 compatibility for Codex device login and review-session model runtime handling.

## 2.2.9

### Changes

- [#128](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/128) [`7bcf709`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7bcf709f700056cbc921bf597fd5ff0267f2706a) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Remove redundant tool-name labels from promoted Code Mode usage contracts.

## 2.2.8

### Changes

- [#124](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/124) [`556ac48`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/556ac482bad77fb8e76d9e218687ab10ad0d2f70) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Clarify Code Mode output and continuation tool guidance.

## 2.2.7

### Changes

- [#118](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/118) [`9b00dea`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/9b00deac82223f8a26c9c918c29e003fc03f0d25) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Scope cached OpenAI Codex WebSocket shutdown to the Pi session being closed so in-process sibling sessions keep their connections.

## 2.2.6

### Changes

- [#115](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/115) [`f6bf8d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f6bf8d953cbb2de661b628a311dcbbc01367b250) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Route Code Mode web search through explicitly configured Responses proxies using their active model and endpoint.

## 2.2.5

### Changes

- [#111](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/111) [`5cf7d6b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5cf7d6b3ef6769b884d3458e80baafcd9dce5648) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix extension startup in Pi by using its modern root API factory instead of a runtime pi-ai subpath import.

## 2.2.4

### Changes

- [#109](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/109) [`cbe2950`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cbe295098ea5668102963ca9e27982864635eea7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Respect Pi skill exclusions and keep native `.agents` discovery in Pi.
  - Prepare the V8 host early, preserve raw exec diagnostics, support proxy authentication, separate Lite transport, and keep the tool contract compact.

## 2.2.3

### Changes

- [#106](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/106) [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rewrite package documentation around current installation, configuration, usage, and behavior.

## 2.2.2

### Changes

- [#104](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/104) [`819bf9c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/819bf9c0a2f72a1d9131c50ebedafe354f67cf3f) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Preserve Codex prompt caches when extensions activate tools dynamically and pass through explicit tool choice on Pi 0.80.7.

## 2.2.1

### Changes

- [#100](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/100) [`14cfe97`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/14cfe97fcde447b9981d2ab755fcf65f1cc71ecf) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Let bundled Code Mode spawn agents inherit the parent Codex extension and active tool surface.

- [#100](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/100) [`14cfe97`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/14cfe97fcde447b9981d2ab755fcf65f1cc71ecf) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Restore GPT-5.6 Code Mode tools after Pi reloads extensions or switches sessions.

## 2.2.0

### Changes

- [#94](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/94) [`a820d16`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a820d161749acfa010b1212cef40cb51efa5e023) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add GPT-5.6 Code Mode with the Responses Lite transport, a freeform `exec` and `wait` surface, Codex-compatible nested patch/web/image tools, schema-free PATH tools, deferred custom TOML tools with bundled opt-in templates, and configurable Codex-style or detailed nested-tool rendering.

## 2.1.7

### Changes

- [#82](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/82) [`4b52058`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4b52058203bc119e1cd5b212d9fa7471a067d752) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Sync the Codex provider with Pi 0.80.6 and use GPT-5.6 Luna for web search, image descriptions, and native compaction.
  - Add helper model choices, reasoning limits, zstd SSE, usage accounting, session identity, socket rotation, prewarming, sticky routing, and validated Responses Lite.
  - Keep the background shell widget TUI-only and publish a precompiled Node 22 entrypoint with lazy optional parsers.
  - Split registration, lifecycle, tools, events, and UI into owned modules with tighter adapter contracts.
  - Resolve compaction context and reasoning limits from the configured compaction model.

## 2.1.6

### Changes

- [#69](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/69) [`8b8ddb4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b8ddb47812a6033b01f66e5442f282b4dc84d44) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Fixes PATH-mode apply_patch previews with trailing shell commands and keeps PATH web_run/imagegen commands on the long wait path.

- [#69](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/69) [`8b8ddb4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8b8ddb47812a6033b01f66e5442f282b4dc84d44) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Updates the Codex provider compatibility pass for Pi 0.80.1.

## 2.1.5

### Changes

- [#65](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/65) [`47351f8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/47351f85c22e6b9e32ff6929e8cb63f4431473a2) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Keep native Responses compaction scoped to OpenAI Codex and explicitly configured providers when the adapter is enabled for all models.

## 2.1.4

### Changes

- [#63](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/63) [`80ca67c`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/80ca67c5a2131b10d4bbb5a642e04e95fda547da) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Use Codex subscription auth for web and image tools on all models and route image generation through Codex endpoints.
  - Add optional image descriptions, shrink oversized tool outputs before compaction, and fix PATH apply-patch expansion.
  - Add compact tool summaries, avoid rereading generated images, warn about stale checkouts, and show local-build guidance.

## 2.1.3

### Changes

- [#60](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/60) [`6de2278`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6de22781a8c449ccf193fcd66773754b08facfe7) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Bounds collapsed exec_command previews for large outputs and adds an all-models extras-only mode with per-tool overlays for apply_patch, view_image, web_run, and imagegen.

## 2.1.2

### Changes

- [#56](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/56) [`cd98303`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cd983037da3344ce7790af09f873d2b82799ea55) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix collapsed exec rendering for errored tool results without structured output details.

## 2.1.1

### Changes

- [#53](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/53) [`4c2e803`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4c2e803f3cc9d9fe7daa0e54f4548af536c8b472) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Use Codex subscription auth for web and image tools on all models and route image generation through Codex endpoints.
  - Add optional image descriptions, shrink oversized tool outputs before compaction, and fix PATH apply-patch expansion.
  - Add compact tool summaries, avoid rereading generated images, warn about stale checkouts, and show local-build guidance.

## 2.1.0

### Changes

- [#50](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/50) [`a9bbba8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/a9bbba894a04bc43b4af9e31d68bd3323617b1b8) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add Codex reset-credit counts and a Ctrl+R reset action in Usage.
  - Theme the adapter status and show collapsed shell previews and capped patch diffs.
  - Preserve raw PATH shell behavior and use the active workdir for apply-patch previews.
  - Keep failed patch rendering segmented and surface exec-bridge startup stderr.
  - Document bundled-tool builds and update Pi dependencies, timeouts, and context-window handling.

## 2.0.1

### Changes

- [#42](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/42) [`f380d72`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f380d721c2fbd9956d730cae456aa7f38e4f0546) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Ignore non-Responses thinking signatures when converting Codex context so Anthropic signatures do not crash JSON parsing.

## 2.0.0

### Breaking changes

- [#40](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/40) [`62a18db`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/62a18dbd99346e76e77e610bbde2912854a4365b) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Rework Codex conversion around bundled Rust tools and add PATH mode.
  - Bundle cross-platform tools, remove `node-pty`, and isolate tool crashes from Pi.
  - Expose schema tools and internal PATH commands while trimming prompt and schema overhead.
  - Rework `/codex` settings for tools, PATH mode, search, fast mode, WebSocket caching, compaction, and usage.
  - Move native OpenAI compaction out of beta.

## 1.5.21

### Changes

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Add the model-facing-api-design skill package.
  - Prevent fresh sessions from recursively shrinking reused model context windows.
  - Add a default-on Proxy tools override for web search, image generation, and fast mode.

- [#35](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/35) [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Add a configurable Codex background shell widget for running exec sessions, and use Pi's Windows shell resolution for default Codex exec sessions.

## 1.5.20

### Changes

- [#30](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/30) [`645baa1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/645baa16a2661d04964d5c9409830836a3405ead) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Match Codex background terminal polling by allowing empty `write_stdin` waits to use a dedicated 5-minute cap instead of the normal 30-second exec cap.

## 1.5.19

### Changes

- [#28](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/28) [`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Preserve Codex WebSocket continuation across parallel tool-output replay drift and keep native web-search response items in Responses history for stable follow-up replay.

- [#28](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/28) [`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Adds an `adapterProviders` setting for enabling the Codex adapter on named custom providers.

## 1.5.18

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Align the custom OpenAI Codex provider with Pi 0.77 and 0.78 Responses fixes for explicit API-key handling, SSE abort cleanup, and fallback replay message IDs.

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Update Codex settings links to point at the monorepo package.

## 1.5.17

### Changes

- [#1](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/1) [`d57f0cb`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d57f0cbb5b92ce5cb7cf4736b6012c5ff0bebaae) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix TypeScript errors under the shared workspace typecheck settings.

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
