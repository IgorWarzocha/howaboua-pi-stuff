# @howaboua/pi-extensions

## 0.0.67

- Include bundled package updates:

  - @howaboua/pi-ask: Added a Code and Notebook Mode bridge API. This allows extensions that use Pi TUI to run inside `exec`.
  - @howaboua/pi-better-skills-tool: Initial release of Better Skills for progressive skill discovery in normal Pi, Code Mode, and Notebook Mode. - List the available catalog first, then load only the requested skill and references. - Combine global, project, and package-provided skills while respecting invocation visibility and local precedence.
  - @howaboua/pi-gippity-control: Fixed waiting indicators for extension UI prompts.
  - @howaboua/pi-gippity-control: Voice summarisation now runs whenever Pi compacts, then starts a fresh realtime session.
  - @howaboua/pi-pet: Fixed waiting indicators for extension UI prompts.
  - @howaboua/pi-shepherdr: Replaced Shepherdr's fire-and-forget tool with persistent blocking and asynchronous agents in normal Pi, Code Mode, and Notebook Mode. - Start, steer, inspect, and answer multiple agents through the `agents` tool. - Customize the bundled general, explorer, and reviewer profiles or add your own. - Activate orchestration mode with `/herdr` when the main session should coordinate agent work.

## 0.0.66

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Restore live Pi speech by streaming visible progress, speaking enabled completed reasoning summaries, and integrating successive updates without replacing active speech.

## 0.0.65

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Speak Pi progress and final results as soon as they reach realtime voice instead of waiting for turn completion.

## 0.0.64

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Keep GipPity voice responsive across typed Pi turns and active speech. Speak one meaningful progress update, serialize final results, preserve interruptions, defer queued follow-up context until its Pi turn begins, resume dropped calls through the dedicated recovery owner, keep LAN certificate startup compatible with asynchronous generation, and keep package changelogs disabled with the extension in Pi config.
  - @howaboua/pi-auto-reasoning-tool: Remove retired bundled extension.
  - @howaboua/pi-markdown-workflows: Remove retired bundled extension.

## 0.0.63

### Changes

- Include bundled package updates:

  - @howaboua/pi-gpt-switcher: Add configurable session context windows and reasoning defaults for GPT shortcuts.

## 0.0.62

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Review a focused JJ revision when its workspace cursor is an empty child commit.

## 0.0.61

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Review the active JJ workspace revision with pinned commit context and an optional cumulative stack base.

## 0.0.60

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control: Run Pi Pet as a first-class GipPity companion. - Meet Clawa through the browser, voice, desktop dictation, a transparent desktop window, or the headless pet-state feed. - Import compatible Codex and ChatGPT pets or author new pets through free-form `/pet` requests. - Keep authored pets and generated displays in durable Pi agent storage, with optional per-repository pet selection. - Attach the local device directly or remote devices through Pi-owned SSH sessions, with each folder remembering where its sessions appear. - Get exact install and reload guidance when GipPity Control is missing or outdated.
  - @howaboua/pi-pet: Run Pi Pet as a first-class GipPity companion. - Meet Clawa through the browser, voice, desktop dictation, a transparent desktop window, or the headless pet-state feed. - Import compatible Codex and ChatGPT pets or author new pets through free-form `/pet` requests. - Keep authored pets and generated displays in durable Pi agent storage, with optional per-repository pet selection. - Attach the local device directly or remote devices through Pi-owned SSH sessions, with each folder remembering where its sessions appear. - Get exact install and reload guidance when GipPity Control is missing or outdated.

## 0.0.59

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Preserve the review findings UI while restoring the `before_agent_start` lifecycle when `/review` is the first session message. - Keep findings custom-rendered, then use a normal user turn for verification and disposition. - Direct the agent to verify findings against the cited code, request user dispositions, and begin agreed work without resummarizing. - End cleanly without a disposition turn when the reviewer finds no actionable issues. - Show this package’s unseen release notes in the shared startup card, with a global suppression setting.

## 0.0.58

### Changes

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Orchestrate Pi agents across named remote Herdr machines with automatic SSH bridge deployment and explicit reconnect controls.

## 0.0.57

### Changes

- Include bundled package updates:

  - @howaboua/pi-unicode-charts: Add terminal-native Unicode bar, line, scatter, sparkline, and heatmap rendering for explicit `chart` Markdown blocks.

## 0.0.56

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Route `/gippity create` through Pi's ordinary user-prompt lifecycle while preserving its transcript card.
    - Condense settings details and show the effective LAN port.
    - Document custom web-app paths and port configuration.

## 0.0.55

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Allow the LAN control server port to be set through lan.port and keep discovery available while a custom app is incomplete.

## 0.0.54

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Add hosted custom remote apps and guided frontend creation.
    - Provide a browser client with agent-readable discovery.
    - Stream Pi events and generic Pi/context RPC through bounded realtime context frames.

## 0.0.53

### Changes

- Include bundled package updates:

  - @howaboua/pi-ask:
    - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
    - Announce compaction and stream conversational Pi updates after two sentences.
    - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
    - Configure delegation acknowledgements and deliver V3 delegations immediately.
    - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
    - Reduce LAN playback dropouts with one more jitter-buffer frame.
  - @howaboua/pi-auto-trees:
    - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
    - Announce compaction and stream conversational Pi updates after two sentences.
    - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
    - Configure delegation acknowledgements and deliver V3 delegations immediately.
    - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
    - Reduce LAN playback dropouts with one more jitter-buffer frame.
  - @howaboua/pi-gippity-control:
    - Follow system audio defaults unless an endpoint is pinned.
    - Keep successfully rerouted output streams active.
    - Share guided first-run and manual audio setup.
  - @howaboua/pi-gippity-control:
    - Show voice-context summarization progress.
    - Greet users through the V3 speakable context channel when realtime sessions are ready.
    - Warn in Pi and the LAN controller when microphone input is too quiet.
  - @howaboua/pi-gippity-control:
    - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
    - Announce compaction and stream conversational Pi updates after two sentences.
    - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
    - Configure delegation acknowledgements and deliver V3 delegations immediately.
    - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
    - Reduce LAN playback dropouts with one more jitter-buffer frame.
  - @howaboua/pi-shepherdr:
    - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
    - Announce compaction and stream conversational Pi updates after two sentences.
    - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
    - Configure delegation acknowledgements and deliver V3 delegations immediately.
    - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
    - Reduce LAN playback dropouts with one more jitter-buffer frame.
  - @howaboua/pi-subagent-review:
    - Add shared realtime voice prompts for ask prompts, Auto Trees, Shepherdr settlements, and review progress.
    - Announce compaction and stream conversational Pi updates after two sentences.
    - Keep silent tool-step summaries compatible without exposing Chat Completions thinking content.
    - Configure delegation acknowledgements and deliver V3 delegations immediately.
    - Preserve late delegations, calls after data-channel closure, prepared Code Mode prompts, and Codex cache continuity.
    - Reduce LAN playback dropouts with one more jitter-buffer frame.

## 0.0.52

### Changes

- Include bundled package updates:

  - @howaboua/pi-shepherdr:
    - Add Shepherdr, a Herdr-native Pi agent orchestrator with event-driven monitoring and a live fleet widget.

## 0.0.51

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Add opt-in dropped realtime voice call auto-resume to GipPity Control and update Undici to its patched release.

## 0.0.50

### Changes

- Include bundled package updates:

  - @howaboua/pi-semantic-grep:
    - Make indexing non-blocking at session startup.
    - Use a single writer with atomic, resumable rebuilds.
    - Respect ignore rules and prioritize metadata, batching, and roles.
    - Preserve usable prior indexes across interrupted rebuilds.

## 0.0.49

### Changes

- Include bundled package updates:

  - @howaboua/pi-auto-trees:
    - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in summaries.
    - Assemble complete multi-block, delta-only RPC streaming updates.
    - Remove retired Smart BTW shortcut-capture and voice-helper exports.
  - @howaboua/pi-gippity-control:
    - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in summaries.
    - Assemble complete multi-block, delta-only RPC streaming updates.
    - Remove retired Smart BTW shortcut-capture and voice-helper exports.
  - @howaboua/pi-smart-btw:
    - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in summaries.
    - Assemble complete multi-block, delta-only RPC streaming updates.
    - Remove retired Smart BTW shortcut-capture and voice-helper exports.
  - @howaboua/pi-subagent-review:
    - Preserve Pi 0.84 credential-resolved endpoints and nullable auth headers in summaries.
    - Assemble complete multi-block, delta-only RPC streaming updates.
    - Remove retired Smart BTW shortcut-capture and voice-helper exports.

## 0.0.48

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Seed realtime voice with the selected session context model and reasoning level, using clean conversational summaries.
    - Show the startup summary in a display-only Voice Context entry and preserve native Responses checkpoints without sharing the main cache lane.
    - Guide spoken delegation lifecycle and restore normal interaction after exit or restart, including device handoff.
    - Retain stopped-session transcript tails, keep muted calls alive, and show finalized spoken turns once without partial recognition.
    - Route clean delegation envelopes with deduplicated history and map assistant messages to realtime commentary or speech at message boundaries.
    - Display completed voice replies once and request delegation acknowledgement fillers.
    - Tighten Code Mode, shell, session-resumption, Windows, prompt-path, and voice-context guidance.

## 0.0.47

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Render voice and dictation cards immediately without adding them to model context.
    - Carry conversation transcripts with actual delegations and preserve realtime audio cadence across coarse timers.
    - Steer long Code Mode commands through exec/wait and report repeated native compaction usage.

## 0.0.46

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Make realtime voice more conversational with Codex voice, host-owned LAN WebRTC, device takeover, buffering, packet reordering, and loss concealment.
    - Keep voice alive across Pi model changes and avoid unnecessary transport resets when saving settings.
    - Ship prompt schemas as raw Markdown with agent-assisted migration.
    - Reject incompatible voice helpers immediately and preserve LAN startup errors through cleanup.

## 0.0.45

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Add reconnect-safe realtime microphone mute controls and native input gating.
  - @howaboua/pi-subagent-review:
    - Replace the review subprocess transport with Pi's maintained RPC client, preserve failed-run diagnostics, prevent review-loop bookkeeping from creating empty summaries, and reissue guidance for each fresh review loop.

## 0.0.44

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Add standalone GipPity voice and LAN control for any Pi model, including synchronized steering between active Pi and Realtime turns.
    - Recover the browser when its upstream helper exits, serialize shutdown cleanup, support configured proxies on Node, and declare the required Node runtime.
  - @howaboua/pi-dynamic-tools:
    - Correct Herdr delivery failures to acknowledge that messages may already be queued.
  - @howaboua/pi-codex-conversion-lite:
    - Serve session-scoped Codex voice, editable dictation drafts, and Pi activity from the themed GipPity LAN remote with seamless audio takeover between devices.
    - Add a configurable control-server shortcut and remove obsolete V2 conversation settings; realtime voice always uses V3 while dictation remains a separate action.
    - Route Realtime delegations into active Pi turns as immediate steering and mirror direct Pi steering back to the owning voice delegation.
    - Keep retries on WebSocket after mid-stream disconnects, route dictation through configured proxies on Node, recover the LAN remote when its upstream helper exits, and let cleared audio devices remain cleared.
    - Preserve the active provider prompt during V2 compaction so prompt caches remain hot, pass V2 feature headers through prewarmed sockets, and reconcile tool calls with their outputs after every history rewrite.
    - Refresh the disabled Herdr example and add a categorized lazy skill loader alongside the existing additive loader.
    - Mark this as the final Lite release and show the remove-then-install migration commands on startup.

## 0.0.43

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Recover failed Codex WebSocket sessions through SSE until compaction restores cached sockets.
    - Serialize patch mutations, retain partial patch errors, and accept model-style image paths.

## 0.0.42

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Keep Codex WebSocket continuations alive through the backend cache window so delayed compaction can reuse the hot context.

## 0.0.41

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Migrate legacy function-shaped exec history to native custom-tool IDs so existing Code Mode sessions resume across the tool-contract upgrade.

## 0.0.40

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Use the configurable lightweight model for tree summaries.
    - Clarify workflow, review-context, summary-session, and RPC protocol ownership.
  - @howaboua/pi-auto-trees:
    - Use the configurable lightweight model for tree summaries.
    - Clarify workflow, review-context, summary-session, and RPC protocol ownership.
  - @howaboua/pi-codex-conversion-lite:
    - Clarify Code Mode tool exposure as configured tools change and limit `ALL_TOOLS` to deferred custom tools.
    - Add an opt-in prompt overwrite that preserves chained extensions and refreshes cached transport state.
    - Install the Code Mode host correctly under Bun and replay completed exec results with per-poll output caps.
    - Keep selected extra tools in voice-only mode and support locally built Rust binaries.
    - Preserve GPT-5.6 history to the compaction budget, report V2 cache usage, and identify Lite requests.

## 0.0.39

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Yield silent shell commands as sessions while active commands continue waiting.
    - Encourage concise progress updates during longer realtime voice work.

## 0.0.38

### Changes

- Include bundled package updates:

  - @howaboua/pi-auto-trees:
    - Add /prime command with automatic settled-agent markers.

## 0.0.37

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Use bounded raw PTY output while preserving large pipe payloads and reporting omitted output in token counts.
    - Clarify safe JavaScript quoting for multiline Code Mode commands.

## 0.0.36

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Keep web_run requests isolated to explicit search and navigation arguments instead of leaking conversation context into search answers.

## 0.0.35

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Prevent native dynamic imports from escaping Pi's loader aliases and verify every packed lazy module can load.

## 0.0.34

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Make published Codex extension artifacts reuse Pi's provider streams and verify packed extensions load before release.

## 0.0.33

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Add the Lite Codex adapter with structured Responses tools, GPT-5.6 Code Mode, routed settings, shared config, native helpers, compaction, and voice.
    - Show active Code Mode executions immediately, keep foreground commands attached, and back off yielded shell sessions.
    - Preserve transport policy, decode bounded terminal output, and install the Code Mode host in-process on Windows.
    - Keep Lite out of aggregate bundles while preserving full-adapter config fields.

## 0.0.32

### Changes

- Include bundled package updates:

  - @howaboua/pi-gpt-switcher:
    - Add `/sol`, `/terra`, and `/luna` commands for switching GPT-5.6 Codex models and reasoning levels.

## 0.0.31

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Reinjects the review advisory preface when compaction has removed the earlier preface from active session context.

## 0.0.30

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Preserve exec_command startup failures and recover confused process continuations.
    - Avoid duplicate nested image rendering.
    - Align Code Mode commands with forced yield times, project-local discovery, named configuration failures, and bundled examples.

## 0.0.29

### Changes

- Include bundled package updates:

  - @howaboua/pi-cache-hit-predictor:
    - Show inline cache-hit predictions when switching models or reasoning lanes.
    - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.
  - @howaboua/pi-auto-reasoning-tool:
    - Show inline cache-hit predictions when switching models or reasoning lanes.
    - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

## 0.0.28

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Adds Pi 0.80.8 compatibility for Codex device login and review-session model runtime handling.
  - @howaboua/pi-ask:
    - Uses configured Pi keybindings for ask navigation and theme-native TUI colors.

## 0.0.27

### Changes

- Include bundled package updates:

  - @howaboua/pi-ask:
    - Remove the duplicated ask tool name from the model-facing prompt inventory.

## 0.0.26

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.

## 0.0.25

### Changes

- Include bundled package updates:

  - @howaboua/pi-ask:
    - Report open ask panels as blocked to Herdr's Pi integration.

## 0.0.24

### Changes

- Include bundled package updates:

  - @howaboua/pi-ask:
    - Add interactive human input, review triage, and handoff prompts through the `ask` tool, plus configurable `/fold` and `/grill` workflows.

## 0.0.23

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Load nested AGENTS.md context from successful pi-codex Code Mode tool traces.
  - @howaboua/pi-auto-reasoning-tool:
    - Tighten the change_reasoning agent contract and clarify responses at the user's minimum.
  - @howaboua/pi-auto-trees:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-smart-btw:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-subagent-review:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-vent:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-dynamic-tools:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-memories:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-explore-subagents:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-semantic-grep:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.

## 0.0.22

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Uses Pi's compaction-aware active session entries when preparing review conversation summaries, preventing superseded history from overflowing the summary model.

## 0.0.21

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Add a JSON `toolRegistration` setting that can hide the agent tool while keeping the rest of each extension active.
  - @howaboua/pi-subagent-review:
    - Add bundled promoted examples for subagents, vent logging, workflow creation, and semantic grep.
    - Require each subagent to perform its assigned role without further delegation.
  - @howaboua/pi-dynamic-tools:
    - Add bundled promoted examples for subagents, vent logging, workflow creation, and semantic grep.
    - Require each subagent to perform its assigned role without further delegation.
  - @howaboua/pi-semantic-grep:
    - Add a JSON `toolRegistration` setting that can hide the agent tool while keeping the rest of each extension active.

## 0.0.20

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Guide long-running cells away from frequent model-driven polling.

## 0.0.19

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Require concise usage contracts for promoted and deferred dynamic tools.

## 0.0.18

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Always register `exec` and `wait`, rediscover TOML definitions during live sessions, and avoid duplicate registration when loaded directly and through an aggregate package.

## 0.0.17

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - 0.0.1 initial release with TOML-defined dynamic tools, Codex code mode, and bundled `spawn_agent` and `port_info` examples.

## 0.0.16

### Changes

- Include bundled package updates:

  - @howaboua/pi-smart-btw:
    - Uses GPT-5.6 Luna for side-session questions by default.
  - @howaboua/pi-subagent-review:
    - Uses GPT-5.6 Sol for reviews and GPT-5.6 Luna for conversation summaries by default.
  - @howaboua/pi-explore-subagents:
    - Uses GPT-5.6 Luna for shallow discovery and GPT-5.6 Terra for deep discovery by default.

## 0.0.15

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Pins compatibility checks to Pi 0.80.6 and verifies current session, TUI, tool, and file-mutation APIs.
  - @howaboua/pi-auto-reasoning-tool:
    - Preserves the user's reasoning floor through Pi 0.80.6 retries, compaction, and queued continuations while keeping autonomous choices capped at high.
  - @howaboua/pi-auto-trees:
    - Pins compatibility checks to Pi 0.80.6 and verifies current session, TUI, tool, and file-mutation APIs.
  - @howaboua/pi-smart-btw:
    - Persists display-only BTW results with Pi 0.80.6 entry renderers and waits for settled child runs without limiting active work time.
  - @howaboua/pi-subagent-review:
    - Runs review summaries through Pi's public session SDK and uses settled RPC completion with Pi 0.80.6 thinking levels.
  - @howaboua/pi-vent:
    - Pins compatibility checks to Pi 0.80.6 and verifies current session, TUI, tool, and file-mutation APIs.
  - @howaboua/pi-memories:
    - Runs memory distillation only when Pi quits and accepts the Pi 0.80.6 max thinking level.
  - @howaboua/pi-explore-subagents:
    - Use Pi 0.80.6 `agent_settled` completion.
    - Accept maximum-thinking configurations.
    - Keep active subagent work free of wall-clock limits.
  - @howaboua/pi-semantic-grep:
    - Compiles against Pi 0.80.6 extension and renderer types without local module shims and cleans up indexing state on shutdown.

## 0.0.14

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Refine standalone and bundled skill-creation guidance.
    - Harden the checker with Pi limits and supporting-file suggestions.

## 0.0.13

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Fixes Pi 0.80 extension loading for review summary model calls.

## 0.0.12

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-auto-reasoning-tool:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-auto-trees:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-smart-btw:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-subagent-review:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-vent:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-memories:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-explore-subagents:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.
  - @howaboua/pi-semantic-grep:
    - Updates Pi core package compatibility for Pi 0.80.1 and migrates summary model calls to the Pi 0.80 raw API entrypoints.

## 0.0.11

### Changes

- Include bundled package updates:

  - @howaboua/pi-semantic-grep:
    - Streams semantic search rows from SQLite and keeps only the best matches in memory, avoiding heap exhaustion on large indexes.

## 0.0.10

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.
  - @howaboua/pi-markdown-workflows:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.
  - @howaboua/pi-auto-trees:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.
  - @howaboua/pi-semantic-grep:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.
  - @howaboua/pi-vent:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.
  - @howaboua/pi-smart-btw:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.
  - @howaboua/pi-explore-subagents:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.
  - @howaboua/pi-auto-reasoning-tool:
    - Bump Pi peer and runtime dependencies to 0.79.0.
    - Treat isolated review findings as advisory input, not automatic implementation work.

## 0.0.9

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.

## 0.0.8

### Changes

- Include bundled package updates:

  - @howaboua/pi-explore-subagents:
    - Persist only minimal explore subagent result metadata in parent sessions instead of the child subagent transcript.

## 0.0.7

### Changes

- Include bundled package updates:

  - @howaboua/pi-auto-reasoning-tool:
    - Restore reasoning to the current agent turn's starting level instead of reusing the first level captured after extension load.

## 0.0.6

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Keep the review-loop advisory preface in history during summarization.
    - Send review findings as custom review messages on every path.
    - Harden Smart BTW slot bounds and answer handling.
    - Improve subdirectory context discovery from shell output.
    - Remove the missing file from the skills aggregate manifest.
  - @howaboua/pi-markdown-workflows:
    - Keep the review-loop advisory preface in history during summarization.
    - Send review findings as custom review messages on every path.
    - Harden Smart BTW slot bounds and answer handling.
    - Improve subdirectory context discovery from shell output.
    - Remove the missing file from the skills aggregate manifest.
  - @howaboua/pi-smart-btw:
    - Multi-slot BTW sessions with JSONL restore, tombstones, inject-and-clear, and configurable alt shortcuts.

## 0.0.5

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Load aggregate extension entries through package-local shims so dependency resolution prefers the aggregate package's own installed dependency versions.

## 0.0.4

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Add `/review loop` markers that summarize completed review-fix increments before the next review pass.

## 0.0.3

### Changes

- `@howaboua/pi-explore-subagents` now stores configuration in the user agent directory and migrates existing package-local config on first use.
- `@howaboua/pi-auto-trees` now shows temporary `/end` progress feedback while summarising back to the marker.

### Updated bundled packages

- `@howaboua/pi-explore-subagents@0.1.6`
- `@howaboua/pi-auto-trees@0.1.4`

## 0.0.2

### Changes

- [#6](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/6) [`e793612`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/e793612fb32a4f7e418f5d28772e6de75a5c26ad) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix aggregate package resource paths so Pi can load installed dependency extensions and skills.

## 0.0.1

### Changes

- [`3c8c222`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3c8c2222bb8d907a85517dd2155f8ea77d2441fb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Initial public release from the Howaboua Pi Stuff monorepo.

