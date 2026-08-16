# @howaboua/pi-stuff

## 0.0.64

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review: Preserve the review findings UI while restoring the `before_agent_start` lifecycle when `/review` is the first session message. - Keep findings custom-rendered, then use a normal user turn for verification and disposition. - Direct the agent to verify findings against the cited code, request user dispositions, and begin agreed work without resummarizing. - End cleanly without a disposition turn when the reviewer finds no actionable issues. - Show this package’s unseen release notes in the shared startup card, with a global suppression setting.

- Updated dependencies [[`8456135`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8456135c54113c01541c8ee8874baa1bd9eefa59)]:
  - @howaboua/pi-subagent-review@0.2.17

## 0.0.63

### Changes

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Orchestrate Pi agents across named remote Herdr machines with automatic SSH bridge deployment and explicit reconnect controls.

- Updated dependencies [[`b20e7de`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b20e7de137fe89344bc15b06c7e7e0bf02a896b3)]:
  - @howaboua/pi-shepherdr@0.1.2

## 0.0.62

### Changes

- Include bundled package updates:

  - @howaboua/pi-unicode-charts: Add terminal-native Unicode bar, line, scatter, sparkline, and heatmap rendering for explicit `chart` Markdown blocks.

## 0.0.61

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Route `/gippity create` through Pi's ordinary user-prompt lifecycle while preserving its transcript card.
    - Condense settings details and show the effective LAN port.
    - Document custom web-app paths and port configuration.

- Updated dependencies [[`439c7f0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/439c7f05c5e5c8a1d8a69ae133167e56289af555)]:
  - @howaboua/pi-gippity-control@0.0.12

## 0.0.60

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Allow the LAN control server port to be set through lan.port and keep discovery available while a custom app is incomplete.

- Updated dependencies [[`0e4e876`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/0e4e87648c8612253b3e0758652077f1c8f4ef57)]:
  - @howaboua/pi-gippity-control@0.0.11

## 0.0.59

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Add hosted custom remote apps and guided frontend creation.
    - Provide a browser client with agent-readable discovery.
    - Stream Pi events and generic Pi/context RPC through bounded realtime context frames.

- Updated dependencies [[`adfe989`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/adfe989598cab149c483a595e0108f917b7c40fa)]:
  - @howaboua/pi-gippity-control@0.0.10

## 0.0.58

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

- Updated dependencies [[`85b0a1f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/85b0a1f3f22a4e6f8c98211fefe8388c3be39d29), [`df747db`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/df747dbc74520d11f7e56e3d85e2df81f5facba2), [`6138ffd`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6138ffd735bb4f7f80e451320dbfd0933a4acaa7)]:
  - @howaboua/pi-gippity-control@0.0.9
  - @howaboua/pi-ask@0.0.5
  - @howaboua/pi-auto-trees@0.1.13
  - @howaboua/pi-shepherdr@0.1.1
  - @howaboua/pi-subagent-review@0.2.16

## 0.0.57

### Changes

- Include bundled package updates:

  - @howaboua/pi-shepherdr:
    - Add Shepherdr, a Herdr-native Pi agent orchestrator with event-driven monitoring and a live fleet widget.

## 0.0.56

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Add opt-in dropped realtime voice call auto-resume to GipPity Control and update Undici to its patched release.

- Updated dependencies [[`c9fcbf8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c9fcbf8a44adff914ed8c4a86703a35d503e4b0b)]:
  - @howaboua/pi-gippity-control@0.0.8

## 0.0.55

### Changes

- Include bundled package updates:

  - @howaboua/pi-semantic-grep:
    - Make indexing non-blocking at session startup.
    - Use a single writer with atomic, resumable rebuilds.
    - Respect ignore rules and prioritize metadata, batching, and roles.
    - Preserve usable prior indexes across interrupted rebuilds.

- Updated dependencies [[`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa)]:
  - @howaboua/pi-semantic-grep@0.1.19

## 0.0.54

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

- Updated dependencies [[`5657b77`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5657b778f59ffa2eb86f10f7e949f060d95eb993)]:
  - @howaboua/pi-auto-trees@0.1.12
  - @howaboua/pi-gippity-control@0.0.7
  - @howaboua/pi-smart-btw@0.2.6
  - @howaboua/pi-subagent-review@0.2.15

## 0.0.53

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-gh-stack:
    - Add tested noninteractive command guidance.
    - Lazy-load command and recovery references.
    - Add machine-readable state contracts and issue-batch stack design.

- Updated dependencies [[`f05fa46`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f05fa469e034ec0e47f238f213437e5a11f2b13c)]:
  - @howaboua/pi-skill-gh-stack@0.0.2

## 0.0.52

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-gh-stack:
    - Add dependency-layer planning and noninteractive `gh-stack` workflows.
    - Cover synchronization and conflict recovery.
    - Support safe partial or whole-stack merges.

- Updated dependencies [[`f3dcf5e`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f3dcf5e01b850e4de57801450eba9464f750b11d)]:
  - @howaboua/pi-skill-gh-stack@0.0.1

## 0.0.51

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

- Updated dependencies [[`c42c408`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c42c40800b53e23f6d3ef4d0af1f41e6179290a1)]:
  - @howaboua/pi-gippity-control@0.0.6

## 0.0.50

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Render voice and dictation cards immediately without adding them to model context.
    - Carry conversation transcripts with actual delegations and preserve realtime audio cadence across coarse timers.
    - Steer long Code Mode commands through exec/wait and report repeated native compaction usage.

- Updated dependencies [[`47bd29a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/47bd29a9b89bb3e2a8d50d4a7b3d84e981d8a34c)]:
  - @howaboua/pi-gippity-control@0.0.5

## 0.0.49

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Make realtime voice more conversational with Codex voice, host-owned LAN WebRTC, device takeover, buffering, packet reordering, and loss concealment.
    - Keep voice alive across Pi model changes and avoid unnecessary transport resets when saving settings.
    - Ship prompt schemas as raw Markdown with agent-assisted migration.
    - Reject incompatible voice helpers immediately and preserve LAN startup errors through cleanup.

- Updated dependencies [[`981e04a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/981e04a6660e36131c81eb2cbaef105fcb94e5b0)]:
  - @howaboua/pi-gippity-control@0.0.4

## 0.0.48

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-codex-prompt-caching:
    - Add a Codex prompt-caching skill covering GPT-5.6 caching, Codex request continuity, Pi hooks, compaction, dynamic tools, measurement, and extension review.

- Updated dependencies [[`2023aa0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2023aa005da4d32f9af0b9bc161c9224d8c60486)]:
  - @howaboua/pi-skill-codex-prompt-caching@0.0.1

## 0.0.47

### Changes

- Include bundled package updates:

  - @howaboua/pi-gippity-control:
    - Add reconnect-safe realtime microphone mute controls and native input gating.
  - @howaboua/pi-subagent-review:
    - Replace the review subprocess transport with Pi's maintained RPC client, preserve failed-run diagnostics, prevent review-loop bookkeeping from creating empty summaries, and reissue guidance for each fresh review loop.

- Updated dependencies [[`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736), [`05f2da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/05f2da3e7b540d30eaada94c527b6ecbef80f736)]:
  - @howaboua/pi-subagent-review@0.2.14
  - @howaboua/pi-gippity-control@0.0.3

## 0.0.46

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

- Updated dependencies [[`dca7267`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dca7267730098e7cfcdd068ae8f032008f2033d7)]:
  - @howaboua/pi-dynamic-tools@0.0.8

## 0.0.45

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Recover failed Codex WebSocket sessions through SSE until compaction restores cached sockets.
    - Serialize patch mutations, retain partial patch errors, and accept model-style image paths.

## 0.0.44

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Keep Codex WebSocket continuations alive through the backend cache window so delayed compaction can reuse the hot context.

## 0.0.43

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Migrate legacy function-shaped exec history to native custom-tool IDs so existing Code Mode sessions resume across the tool-contract upgrade.

## 0.0.42

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

- Updated dependencies [[`18868c1`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/18868c1ba0257f7d6ddeeb7dfc51f3af467e4633)]:
  - @howaboua/pi-auto-trees@0.1.11
  - @howaboua/pi-subagent-review@0.2.13

## 0.0.41

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Yield silent shell commands as sessions while active commands continue waiting.
    - Encourage concise progress updates during longer realtime voice work.

## 0.0.40

### Changes

- Include bundled package updates:

  - @howaboua/pi-auto-trees:
    - Add /prime command with automatic settled-agent markers.

- Updated dependencies [[`bf58bdc`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/bf58bdce157ca9c3c7869b629ad148bd05a3a100)]:
  - @howaboua/pi-auto-trees@0.1.10

## 0.0.39

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Use bounded raw PTY output while preserving large pipe payloads and reporting omitted output in token counts.
    - Clarify safe JavaScript quoting for multiline Code Mode commands.

## 0.0.38

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Keep web_run requests isolated to explicit search and navigation arguments instead of leaking conversation context into search answers.

## 0.0.37

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Prevent native dynamic imports from escaping Pi's loader aliases and verify every packed lazy module can load.

## 0.0.36

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Make published Codex extension artifacts reuse Pi's provider streams and verify packed extensions load before release.

## 0.0.35

### Changes

- Include bundled package updates:

  - @howaboua/pi-codex-conversion-lite:
    - Add the Lite Codex adapter with structured Responses tools, GPT-5.6 Code Mode, routed settings, shared config, native helpers, compaction, and voice.
    - Show active Code Mode executions immediately, keep foreground commands attached, and back off yielded shell sessions.
    - Preserve transport policy, decode bounded terminal output, and install the Code Mode host in-process on Windows.
    - Keep Lite out of aggregate bundles while preserving full-adapter config fields.
  - @howaboua/pi-skill-gh-issue-pr-flow:
    - Cull feature-existence and implementation-coupled tests before final PR submission, retaining only independently justified contract coverage.

- Updated dependencies [[`70c9973`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/70c9973b8509d2ebefc26acef5c25d1e01b47d47)]:
  - @howaboua/pi-skill-gh-issue-pr-flow@0.0.7

## 0.0.34

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-agent-native-hardening:
    - Add execution-topology guidance for agent-navigable call stacks.
    - Measure import, initialization, startup, and bundle performance.

- Updated dependencies [[`5118fd9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5118fd9c29c050316a4fa1cf9122b501710e7056)]:
  - @howaboua/pi-skill-agent-native-hardening@0.0.6

## 0.0.33

### Changes

- Include bundled package updates:

  - @howaboua/pi-gpt-switcher:
    - Add `/sol`, `/terra`, and `/luna` commands for switching GPT-5.6 Codex models and reasoning levels.

## 0.0.32

### Changes

- Include bundled package updates:

  - @howaboua/pi-skill-model-facing-api-design:
    - Document model-facing punctuation and token-cost hygiene.

- Updated dependencies [[`94b2252`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/94b225295be07e04206460963fd3da754a74565e)]:
  - @howaboua/pi-skill-model-facing-api-design@0.0.5

## 0.0.31

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Reinjects the review advisory preface when compaction has removed the earlier preface from active session context.

- Updated dependencies [[`799a4b2`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/799a4b24e5b49a1020c95524209c01112625aa6b)]:
  - @howaboua/pi-subagent-review@0.2.12

## 0.0.30

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Preserve exec_command startup failures and recover confused process continuations.
    - Avoid duplicate nested image rendering.
    - Align Code Mode commands with forced yield times, project-local discovery, named configuration failures, and bundled examples.

- Updated dependencies [[`5fd1368`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/5fd13686f185d21782db8839ae0d798d32163874)]:
  - @howaboua/pi-dynamic-tools@0.0.7

## 0.0.29

### Changes

- Include bundled package updates:

  - @howaboua/pi-cache-hit-predictor:
    - Show inline cache-hit predictions when switching models or reasoning lanes.
    - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.
  - @howaboua/pi-auto-reasoning-tool:
    - Show inline cache-hit predictions when switching models or reasoning lanes.
    - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

- Updated dependencies [[`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff)]:
  - @howaboua/pi-auto-reasoning-tool@0.1.11

## 0.0.28

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Adds Pi 0.80.8 compatibility for Codex device login and review-session model runtime handling.
  - @howaboua/pi-ask:
    - Uses configured Pi keybindings for ask navigation and theme-native TUI colors.

- Updated dependencies [[`828f52e`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/828f52eff1291629d73c3058173cff2fa60e3b28), [`828f52e`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/828f52eff1291629d73c3058173cff2fa60e3b28)]:
  - @howaboua/pi-subagent-review@0.2.11
  - @howaboua/pi-ask@0.0.4

## 0.0.27

### Changes

- Include bundled package updates:

  - @howaboua/pi-ask:
    - Remove the duplicated ask tool name from the model-facing prompt inventory.

- Updated dependencies [[`9604ec3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/9604ec3505eff2d9ee789f42ef45038bc00da02e)]:
  - @howaboua/pi-ask@0.0.3

## 0.0.26

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-agents-md:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-gh-issue-pr-flow:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-agent-native-hardening:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-project-reference-research:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-model-facing-api-design:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-anti-ai-copy:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-adversarial-qa:
    - Add the adversarial-qa skill for falsifying code behaviour with property, differential, mutation, and fuzz testing.
  - @howaboua/pi-skill-skill-creator:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.
  - @howaboua/pi-skill-chrome-cdp:
    - Make skill descriptions terse semantic indexes.
    - Remove redundant purpose or job restatements.
    - Distinguish operational from creative body language where applicable.

- Updated dependencies [[`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5), [`8983df4`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8983df436423fdc2933863611285946dd0319cf5)]:
  - @howaboua/pi-skill-project-reference-research@0.0.4
  - @howaboua/pi-skill-model-facing-api-design@0.0.4
  - @howaboua/pi-skill-agent-native-hardening@0.0.5
  - @howaboua/pi-skill-gh-issue-pr-flow@0.0.6
  - @howaboua/pi-skill-anti-ai-copy@0.0.4
  - @howaboua/pi-skill-chrome-cdp@0.0.4
  - @howaboua/pi-skill-agents-md@0.0.4
  - @howaboua/pi-skill-skill-creator@0.0.5
  - @howaboua/pi-markdown-workflows@0.2.20

## 0.0.25

### Changes

- Include bundled package updates:

  - @howaboua/pi-ask:
    - Report open ask panels as blocked to Herdr's Pi integration.

- Updated dependencies [[`8f82078`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/8f82078a8e733dbe770c7b5fd9ad1b20cd5a21af)]:
  - @howaboua/pi-ask@0.0.2

## 0.0.24

### Changes

- Include bundled package updates:

  - @howaboua/pi-ask:
    - Add interactive human input, review triage, and handoff prompts through the `ask` tool, plus configurable `/fold` and `/grill` workflows.

- Updated dependencies [[`f516f97`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f516f97c76ae27a354f80f85a5a34ecd56c4e9c4)]:
  - @howaboua/pi-ask@0.0.1

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
  - @howaboua/pi-skill-gh-issue-pr-flow:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-skill-chrome-cdp:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-skill-skill-creator:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-skill-project-reference-research:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-skill-model-facing-api-design:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-skill-agent-native-hardening:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-skill-agents-md:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.
  - @howaboua/pi-skill-anti-ai-copy:
    - Rewrite package documentation around current installation, configuration, usage, and behavior.

- Updated dependencies [[`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d), [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d), [`c423031`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c4230312f24db0e49c95eafff959109d74017c3d)]:
  - @howaboua/pi-markdown-workflows@0.2.19
  - @howaboua/pi-auto-trees@0.1.9
  - @howaboua/pi-dynamic-tools@0.0.6
  - @howaboua/pi-explore-subagents@0.1.13
  - @howaboua/pi-memories@0.1.4
  - @howaboua/pi-semantic-grep@0.1.18
  - @howaboua/pi-skill-agent-native-hardening@0.0.4
  - @howaboua/pi-skill-agents-md@0.0.3
  - @howaboua/pi-skill-anti-ai-copy@0.0.3
  - @howaboua/pi-skill-chrome-cdp@0.0.3
  - @howaboua/pi-skill-gh-issue-pr-flow@0.0.5
  - @howaboua/pi-skill-model-facing-api-design@0.0.3
  - @howaboua/pi-skill-project-reference-research@0.0.3
  - @howaboua/pi-skill-skill-creator@0.0.4
  - @howaboua/pi-smart-btw@0.2.5
  - @howaboua/pi-subagent-review@0.2.10
  - @howaboua/pi-vent@0.2.10
  - @howaboua/pi-auto-reasoning-tool@0.1.10

## 0.0.22

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Uses Pi's compaction-aware active session entries when preparing review conversation summaries, preventing superseded history from overflowing the summary model.

- Updated dependencies [[`40ea35b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/40ea35bbdb8c0437b57bd0dc7ddc41dbc21d2cf5)]:
  - @howaboua/pi-subagent-review@0.2.9

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

- Updated dependencies [[`68ceda7`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/68ceda7ee01203df93d181cd940dc1b64d93739d), [`68ceda7`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/68ceda7ee01203df93d181cd940dc1b64d93739d)]:
  - @howaboua/pi-dynamic-tools@0.0.5
  - @howaboua/pi-subagent-review@0.2.8
  - @howaboua/pi-semantic-grep@0.1.17
  - @howaboua/pi-markdown-workflows@0.2.18

## 0.0.20

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Guide long-running cells away from frequent model-driven polling.

- Updated dependencies [[`3f6d93b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3f6d93b44a411ef75370f84069f35368e850ae17)]:
  - @howaboua/pi-dynamic-tools@0.0.4

## 0.0.19

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Require concise usage contracts for promoted and deferred dynamic tools.

- Updated dependencies [[`6c9509a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/6c9509ac0f52fa6d5c59538dc763f8f61fd83e46)]:
  - @howaboua/pi-dynamic-tools@0.0.3

## 0.0.18

### Changes

- Include bundled package updates:

  - @howaboua/pi-dynamic-tools:
    - Always register `exec` and `wait`, rediscover TOML definitions during live sessions, and avoid duplicate registration when loaded directly and through an aggregate package.

- Updated dependencies [[`c75e8ed`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c75e8ed3696c4ba94b73ab91dfe9dfe3aea74c0f)]:
  - @howaboua/pi-dynamic-tools@0.0.2

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

- Updated dependencies [[`dc0d253`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dc0d25382e1b650e024cc235e23ea62117784e23), [`dc0d253`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dc0d25382e1b650e024cc235e23ea62117784e23), [`dc0d253`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dc0d25382e1b650e024cc235e23ea62117784e23)]:
  - @howaboua/pi-explore-subagents@0.1.12
  - @howaboua/pi-subagent-review@0.2.7
  - @howaboua/pi-smart-btw@0.2.4

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

- Updated dependencies [[`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4), [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4), [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4), [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4), [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4), [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4), [`4be919f`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/4be919fea3c8ef6aba79f4a66907bc80d30908d4)]:
  - @howaboua/pi-auto-reasoning-tool@0.1.9
  - @howaboua/pi-explore-subagents@0.1.11
  - @howaboua/pi-memories@0.1.3
  - @howaboua/pi-semantic-grep@0.1.16
  - @howaboua/pi-smart-btw@0.2.3
  - @howaboua/pi-subagent-review@0.2.6
  - @howaboua/pi-auto-trees@0.1.8
  - @howaboua/pi-markdown-workflows@0.2.17
  - @howaboua/pi-vent@0.2.9

## 0.0.14

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Refine standalone and bundled skill-creation guidance.
    - Harden the checker with Pi limits and supporting-file suggestions.
  - @howaboua/pi-skill-gh-issue-pr-flow:
    - Refines the GitHub workflow into a concise, mode-routed SOP while preserving release hygiene and exhaustive Codex review guidance.
  - @howaboua/pi-skill-chrome-cdp:
    - Clarify browser authorization and reject ambiguous or non-interactable targets.
    - Verify editable focus and text insertion.
    - Improve CDP timeout guidance and deterministic new-tab startup.
  - @howaboua/pi-skill-skill-creator:
    - Refine standalone and bundled skill-creation guidance.
    - Harden the checker with Pi limits and supporting-file suggestions.
  - @howaboua/pi-skill-project-reference-research:
    - Makes subagent delegation optional in project reference research, choosing direct or delegated inspection based on repository size, task scope, and context needs.
  - @howaboua/pi-skill-model-facing-api-design:
    - Cover current-API migration gates, results, errors, truncation, and prompt metadata.
    - Improve token-helper detection and reporting.
  - @howaboua/pi-skill-agent-native-hardening:
    - Make scorecards and work lanes conditional.
    - Sharpen evidence-based architecture guidance and add dependency-safety guidance.
    - Document TypeScript 7 migration constraints.
  - @howaboua/pi-skill-agents-md:
    - Refines AGENTS.md authoring around terse scoped instructions, README separation, and proactive nested maintenance.
  - @howaboua/pi-skill-anti-ai-copy:
    - Expand the skill into universal drafting, rewriting, and prose review.
    - Add genre-aware guidance and a broader AI-writing trope reference.

- Updated dependencies [[`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9), [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9), [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9), [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9), [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9), [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9), [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9), [`ff8d5cf`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/ff8d5cf9412ec07fea8b613f0aadc906c6c398f9)]:
  - @howaboua/pi-skill-chrome-cdp@0.0.2
  - @howaboua/pi-skill-project-reference-research@0.0.2
  - @howaboua/pi-skill-gh-issue-pr-flow@0.0.4
  - @howaboua/pi-skill-anti-ai-copy@0.0.2
  - @howaboua/pi-skill-model-facing-api-design@0.0.2
  - @howaboua/pi-skill-agents-md@0.0.2
  - @howaboua/pi-skill-skill-creator@0.0.3
  - @howaboua/pi-markdown-workflows@0.2.16
  - @howaboua/pi-skill-agent-native-hardening@0.0.3

## 0.0.13

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Fixes Pi 0.80 extension loading for review summary model calls.

- Updated dependencies [[`2a4371b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2a4371b67bcf69f5237152e087c6998b4810ab5a)]:
  - @howaboua/pi-subagent-review@0.2.5

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

- Updated dependencies [[`1a4302a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/1a4302ad02a122480aeba29deacaa6f8925571ad)]:
  - @howaboua/pi-auto-reasoning-tool@0.1.8
  - @howaboua/pi-auto-trees@0.1.7
  - @howaboua/pi-explore-subagents@0.1.10
  - @howaboua/pi-markdown-workflows@0.2.15
  - @howaboua/pi-memories@0.1.2
  - @howaboua/pi-semantic-grep@0.1.15
  - @howaboua/pi-smart-btw@0.2.2
  - @howaboua/pi-subagent-review@0.2.4
  - @howaboua/pi-vent@0.2.8

## 0.0.11

### Changes

- Include bundled package updates:

  - @howaboua/pi-semantic-grep:
    - Streams semantic search rows from SQLite and keeps only the best matches in memory, avoiding heap exhaustion on large indexes.

- Updated dependencies [[`f0aeb2a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f0aeb2ae53397a4adfd084911a8ef201dcf5d89e)]:
  - @howaboua/pi-semantic-grep@0.1.14

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

- Updated dependencies [[`f380d72`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f380d721c2fbd9956d730cae456aa7f38e4f0546)]:
  - @howaboua/pi-auto-reasoning-tool@0.1.7
  - @howaboua/pi-auto-trees@0.1.6
  - @howaboua/pi-explore-subagents@0.1.9
  - @howaboua/pi-markdown-workflows@0.2.14
  - @howaboua/pi-semantic-grep@0.1.13
  - @howaboua/pi-smart-btw@0.2.1
  - @howaboua/pi-subagent-review@0.2.3
  - @howaboua/pi-vent@0.2.7

## 0.0.9

### Changes

- Include bundled package updates:

  - @howaboua/pi-markdown-workflows:
    - Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.
  - @howaboua/pi-skill-agents-md:
    - Add the agents-md skill package.
  - @howaboua/pi-skill-skill-creator:
    - Teach skill creation to quote frontmatter descriptions and make the efficiency checker flag unsafe unquoted YAML scalars with line and caret output.
  - @howaboua/pi-skill-model-facing-api-design:
    - Add the model-facing-api-design skill package.
    - Prevent fresh sessions from recursively shrinking reused model context windows.
    - Add a default-on Proxy tools override for web search, image generation, and fast mode.

- Updated dependencies [[`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc), [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc), [`2f03bc0`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/2f03bc04bfac5d7c41db7d3f53280baefa3a5ccc)]:
  - @howaboua/pi-skill-model-facing-api-design@0.0.1
  - @howaboua/pi-skill-skill-creator@0.0.2
  - @howaboua/pi-markdown-workflows@0.2.13
  - @howaboua/pi-skill-agents-md@0.0.1

## 0.0.8

### Changes

- Include bundled package updates:

  - @howaboua/pi-explore-subagents:
    - Persist only minimal explore subagent result metadata in parent sessions instead of the child subagent transcript.

- Updated dependencies [[`f852b3d`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f852b3d94d3d7551e59f1dfa323d9978383b68d1)]:
  - @howaboua/pi-explore-subagents@0.1.8

## 0.0.7

### Changes

- Include bundled package updates:

  - @howaboua/pi-auto-reasoning-tool:
    - Restore reasoning to the current agent turn's starting level instead of reusing the first level captured after extension load.

- Updated dependencies [[`008e017`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/008e01742bad5d743d23f6f445d8defb04610ee3)]:
  - @howaboua/pi-auto-reasoning-tool@0.1.6

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

- Updated dependencies [[`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2), [`cf0ca88`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/cf0ca88feee5175cebda37043b0a0bfb5ad913d2)]:
  - @howaboua/pi-subagent-review@0.2.2
  - @howaboua/pi-smart-btw@0.2.0
  - @howaboua/pi-markdown-workflows@0.2.12

## 0.0.5

### Changes

- [#19](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/19) [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Load aggregate extension entries through package-local shims so dependency resolution prefers the aggregate package's own installed dependency versions.

- Updated dependencies [[`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9), [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9), [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9), [`d312d81`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d312d81f82e24645f7cc59f4b6ead1834afd19f9)]:
  - @howaboua/pi-skill-gh-issue-pr-flow@0.0.3
  - @howaboua/pi-markdown-workflows@0.2.11
  - @howaboua/pi-auto-trees@0.1.5
  - @howaboua/pi-explore-subagents@0.1.7
  - @howaboua/pi-memories@0.1.1
  - @howaboua/pi-semantic-grep@0.1.12
  - @howaboua/pi-smart-btw@0.1.3
  - @howaboua/pi-subagent-review@0.2.1
  - @howaboua/pi-vent@0.2.6

## 0.0.4

### Changes

- Include bundled package updates:

  - @howaboua/pi-subagent-review:
    - Add `/review loop` markers that summarize completed review-fix increments before the next review pass.
  - @howaboua/pi-skill-agent-native-hardening:
    - Make the skill language-agnostic.
    - Add JavaScript/TypeScript, Python, Rust, and Go reference guidance.

- Updated dependencies [[`26d4e8b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/26d4e8b89fb050463bf5cf3486ba1fa0ba84d8b3), [`26d4e8b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/26d4e8b89fb050463bf5cf3486ba1fa0ba84d8b3)]:
  - @howaboua/pi-skill-agent-native-hardening@0.0.2
  - @howaboua/pi-subagent-review@0.2.0

## 0.0.3

### Changes

- `@howaboua/pi-explore-subagents` now stores configuration in the user agent directory and migrates existing package-local config on first use.
- `@howaboua/pi-auto-trees` now shows temporary `/end` progress feedback while summarising back to the marker.
- `@howaboua/pi-skill-gh-issue-pr-flow` now documents safer file-based GitHub issue, PR, and comment body posting.

### Updated bundled packages

- `@howaboua/pi-explore-subagents@0.1.6`
- `@howaboua/pi-auto-trees@0.1.4`
- `@howaboua/pi-skill-gh-issue-pr-flow@0.0.2`

## 0.0.2

### Changes

- [#6](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/6) [`e793612`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/e793612fb32a4f7e418f5d28772e6de75a5c26ad) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Fix aggregate package resource paths so Pi can load installed dependency extensions and skills.

## 0.0.1

### Changes

- [`3c8c222`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3c8c2222bb8d907a85517dd2155f8ea77d2441fb) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:

  - Initial public release from the Howaboua Pi Stuff monorepo.

- Updated dependencies [[`3c8c222`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/3c8c2222bb8d907a85517dd2155f8ea77d2441fb), [`f252da3`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/f252da342444236f06c6da3f7d92cbdab420d770), [`d57f0cb`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/d57f0cbb5b92ce5cb7cf4736b6012c5ff0bebaae), [`9a7890b`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/9a7890b63c7a9fb5be8ab2bdd16c41e78017a5b9)]:
  - @howaboua/pi-memories@0.1.0
  - @howaboua/pi-skill-agent-native-hardening@0.0.1
  - @howaboua/pi-skill-anti-ai-copy@0.0.1
  - @howaboua/pi-skill-chrome-cdp@0.0.1
  - @howaboua/pi-skill-gh-issue-pr-flow@0.0.1
  - @howaboua/pi-skill-project-reference-research@0.0.1
  - @howaboua/pi-skill-skill-creator@0.0.1
  - @howaboua/pi-explore-subagents@0.1.5
  - @howaboua/pi-markdown-workflows@0.2.10
  - @howaboua/pi-semantic-grep@0.1.11
  - @howaboua/pi-smart-btw@0.1.2
  - @howaboua/pi-subagent-review@0.1.53
  - @howaboua/pi-vent@0.2.5
