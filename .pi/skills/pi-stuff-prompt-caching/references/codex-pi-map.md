# Codex and Pi implementation map

Verified **2026-07-31** against:

- OpenAI Codex [`aea26afa`](https://github.com/openai/codex/tree/aea26afaee177d3fe40721ef261a29f89879d505)
- `@earendil-works/pi-coding-agent` / `pi-ai` 0.83.0
- this monorepo's `main` at [`a1af4af`](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/a1af4af60d6de850b3d9db8e818dd5165f0fdbde)

Re-trace touched code: implementation moves faster than this map. Paths below are repository-relative and intentionally avoid machine-specific checkout locations.

## OpenAI Codex

### Request and key

- `codex-rs/core/src/client_common.rs` `Prompt`: ordered input, tool specs, parallel-call flag, base instructions and optional output schema
- `codex-rs/core/src/session/turn.rs` builds each sample from current complete history and visible tools
- `codex-rs/core/src/client.rs` sends base instructions in top-level `instructions`, tools in `tools` and history in `input` for standard Responses
- Responses Lite prepends `additional_tools`, then a developer instructions message, then history; it omits top-level `instructions`/`tools`
- default `prompt_cache_key` is the session ID unless overridden. Normal root/API-key subagents share that session key; guardian review uses `guardian:{parent_thread_id}`
- HTTP resends full input. WebSocket may send only a delta plus `previous_response_id`

Key source areas:

- [`client.rs` request construction](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client.rs#L816-L929)
- [`client_common.rs` prompt shape](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client_common.rs#L16-L61)
- [`prompt_cache_key.rs` integration tests](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/tests/suite/prompt_cache_key.rs#L39-L157)

### Prefix stability

- request input order is preserved
- tool specs retain their planned vector order; tools inside a namespace are name-sorted, but top-level tools are not globally sorted (`core/src/tools/spec_plan.rs`)
- ordinary turn-setting changes append new developer context rather than rewrite earlier history
- prompt-caching integration tests assert stable instructions/tools and repeated history prefix across turns (`core/tests/suite/prompt_caching.rs`)

Those tests prove Codex's client construction, not an OpenAI backend hit.

### WebSocket continuation

Codex's delta mechanism requires the new input to be a strict extension of prior request input plus server output, while request properties match. Matching includes model, instructions, tools, reasoning, service tier, cache key and related request controls. Internal item metadata is ignored for history equality. Otherwise Codex sends a fresh full request without `previous_response_id`.

See [`client.rs` request-property and delta checks](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client.rs#L300-L359) and [input extension logic](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client.rs#L1179-L1259).

At the pinned revision, a model/reasoning change makes the Codex **client** send a full request instead of using this delta mechanism. That does not prove the backend rejects such continuation or that reasoning effort partitions server prompt-cache KV; measure before claiming either.

### Compaction and usage

- local compaction replaces history with collected user messages plus summary/replacement history (`codex-rs/core/src/compact.rs`)
- resume reconstructs from the newest surviving replacement-history checkpoint (`core/src/session/rollout_reconstruction.rs`)
- usage maps `input_tokens_details.cached_tokens` and `cache_write_tokens` into protocol token usage (`codex-api/src/sse/responses.rs`, `protocol/src/protocol.rs`)
- displayed non-cached input subtracts cached input; session totals accumulate read/write fields

## Pi core

### Hook boundaries

Pi 0.83 documents and implements this order:

1. build base system prompt from custom prompt, active tool snippets/guidelines, context files and skills
2. chain `before_agent_start` handlers in extension load order
3. before each LLM call, chain `context` message transforms
4. provider serializes system prompt, messages and active tool definitions
5. chain `before_provider_request` payload transforms in load order

Relevant installed-package docs are `docs/extensions.md`, `docs/compaction.md`, `docs/session-format.md` and `docs/sdk.md`. In source distributions inspect `packages/coding-agent/src/core` and `packages/ai/src` rather than trusting this version note.

### OpenAI providers

- stock OpenAI Responses and OpenAI Codex providers derive `prompt_cache_key` from Pi's session ID and clamp it to 64 Unicode characters
- cache retention `none` omits the key; standard OpenAI Responses on models supporting explicit mode also sends `{mode:"explicit"}` with no breakpoints to disable implicit writes
- normal Responses serializes the full ordered tool vector and context on each stateless request
- Pi usage splits raw OpenAI input into uncached `input`, `cacheRead` and `cacheWrite`

### Default Pi compaction

`completeSummarization()` sends default compaction/branch-summary model calls with a fresh UUID and `cacheRetention: "none"` because each summary prompt is one-off. This isolates it from the main session cache key.

Provider behavior differs:

- stock standard OpenAI Responses omits `prompt_cache_key` and, when explicit mode is supported, sends `{mode:"explicit"}` with no breakpoints to disable GPT-5.6 implicit writes
- stock OpenAI Codex omits the key but currently sends no explicit cache-disable field. Pi requests no retention, but client shape alone cannot guarantee zero backend writes

Pi then rebuilds main context as system prompt + summary + kept messages. Compaction and branch summary are main-conversation prefix boundaries; optimize the rebuilt conversation, not the one-off summary call.

## `pi-codex-conversion`

### Activation and prompt

- `src/adapter/activation/runtime-plan.ts` is the single policy for inactive/extras/normal/code mode, tool surface, prompt mode, transport and native compaction
- `src/extension/events.ts` rewrites the chained system prompt in `before_agent_start`, rewrites the final payload in `before_provider_request`, filters extension display messages in `context` and owns compaction lifecycle wiring
- `src/prompt/build-system-prompt.ts` reconstructs Codex guidance, shell, context, skills and optional heavy overwrite
- model/provider/config/plan changes may alter instructions, active tools, protocol and compaction together; treat every plan transition as cold

The generated prompt can change when Pi's base prompt, active tool snippets, AGENTS/context files, skills, shell, mode or conversion config changes. Heavy overwrite is a different prefix, not an optimization of the normal one.

### Request protocols

`src/providers/openai-codex/request-body.ts` sends:

- top-level `instructions`
- ordered converted `input`
- encrypted reasoning inclusion
- session-derived `prompt_cache_key`, clamped to 64 characters
- tool choice, parallel-call flag, ordered immediate tools
- reasoning effort/summary, verbosity and optional service tier

Code Mode's `src/providers/openai-codex/responses-lite.ts` relocates tools and instructions to the leading input:

```text
additional_tools developer item
→ developer instructions message
→ converted history
```

It also disables parallel tool calls, sets `reasoning.context` to `all_turns`, removes image `detail`, replaces unsupported remote image URLs, and deterministically resizes or replaces inline images before sending. Fingerprint the post-transform images/input. Normal ↔ Code Mode changes prompt layout, tool surface and reasoning properties; never claim cross-mode continuity. “Responses Lite” here is the active OpenAI protocol, unrelated to this repository's archived Lite package.

Current conversion requests send no `prompt_cache_breakpoint`, `prompt_cache_options` or `prompt_cache_retention`. Public GPT-5.6 breakpoint support does not prove the ChatGPT-backed Codex endpoint accepts those fields.

### Cached WebSocket and prewarm

- `src/providers/openai-codex/websocket-continuation.ts` compares request bodies except input/client metadata, then requires exact prior-input extension before adding `previous_response_id`
- current code/tests reject meaningful instruction, tool content/order, persisted history, model or reasoning changes
- `src/extension/runtime.ts` prewarms with active system prompt, active tools including the restored Code Mode grammar, session ID, reasoning, verbosity, service tier and the same request rewrite
- session/model changes and compaction reset transport

The invariant is **prewarm request shape = next real request shape**. A prewarm success is not proof of server prompt-cache tokens; it seeds connection/continuation state.

`UPSTREAM_SYNC.md` records live backend acceptance of `previous_response_id` across model/reasoning changes and says this adapter should exclude those generation settings. Current comparator/tests do not. Treat this as existing implementation/documentation drift: distinguish backend capability, upstream Codex client policy and current adapter behavior before changing or reviewing continuation.

### Native compaction

- `src/adapter/compaction/compaction.ts` serializes current context or reuses a native window, calls remote V2 compaction and installs canonical replay
- unlike default Pi summarization, V2 keeps the clamped main-session `prompt_cache_key` plus active tools, reasoning, service tier and text options. The first call sends active history; later calls send checkpoint + live tail
- oversized requests may replace old tool output with an explicit truncation sentinel (`request-shrink.ts`)
- post-compaction context rewrites the provider input from the encrypted checkpoint, filters display-only compaction messages, resets transport and prewarms the new window
- compaction usage reports input, cache read, cache write and output independently; reads/writes are expected evidence, not accidental Pi-summary caching

Treat the compacted window as fresh. Preserve every checkpoint item, item ID/type, tool pair and order. Do not insert compaction status copy into provider context.

### Code Mode tool discovery

`src/tools/code-mode/tool-events.ts` refreshes custom-tool guidance during `before_agent_start`. Tool definitions/usages are name-sorted before prompt rendering, but installation, enablement, definition edits and documentation paths still change the prompt. Avoid volatile or machine-specific early text; expect a cold transition after a real tool change.

## Other monorepo cache-affecting extensions

### Direct prompt/tool mutation

- **`pi-dynamic-tools`** discovers TOML tools for each `before_agent_start`, sorts definitions by name and injects promoted usage plus a documentation path. Directory/content/path changes alter the system prompt. Its active `exec`/`wait` schemas are also provider-visible tools
- **`pi-markdown-workflows`** appends discovered workflow name, description and relative location each turn. Workflow creation/edit/rename/cwd changes alter the prompt; discovery currently relies on filesystem enumeration order, so cache-sensitive work should make ordering explicit
- **every active registered tool** affects the provider tool vector. This includes tools from `pi-ask`, `pi-explore-subagents`, `pi-semantic-grep`, `pi-vent`, auto reasoning, workflow creation and conversion. Registration/activation order and schema copy are cache surfaces

### Lane changes

- **`pi-auto-reasoning-tool`** can call `pi.setThinkingLevel()` during an agent run and restores baseline after settlement. Switch by meaningful work phase, not around a single call
- **`pi-gpt-switcher`** changes model and reasoning together. This is deliberately a cold model lane
- **`pi-cache-hit-predictor`** keys remembered prompt sizes by provider/API/model/thinking level and clears around compaction/branch summaries. It omits prompt/tool/mode identity and backend TTL, so its UI is an upper-bound estimate; provider `cacheRead` is final

### History mutation

- **`pi-codex-conversion` voice and `pi-gippity-control`** inject canonical mode/state or transcript messages and may route speech as a new user turn or steer. Main-history messages affect later prefixes; the separate Realtime voice system prompt does not alter the main model request
- **`pi-smart-btw`** injects completed side-session answers as user context and filters legacy display/state records. The injected answer is intentional new history, not a cache-preserving operation
- **`pi-auto-trees`**, Pi tree navigation and branch summaries replace/reshape active context. Treat them like compaction
- **`pi-memories`** does not currently mutate the active provider context during ordinary turns; future memory injection would become a prefix surface

## Review heuristics for this repository

When a change touches prompt, provider, tool, compaction or model routing:

1. inspect `runtime-plan.ts` before reconstructing activation predicates elsewhere
2. compare conversion request behavior with Pi's current stock `openai-codex-responses` provider as required by package instructions
3. capture final normal and Code Mode payloads, not only prompt-builder output
4. compare initial, tool-continuation, reconnect and post-compaction requests
5. distinguish server prompt-cache expectations from WebSocket continuation expectations in code, tests and docs
6. preserve stable ordered structures; do not encode incidental full-request snapshots as permanent tests
7. report what is backend-verified, client-shape-only and still unknown
