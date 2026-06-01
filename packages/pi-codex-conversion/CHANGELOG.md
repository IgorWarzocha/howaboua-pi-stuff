# Changelog

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
