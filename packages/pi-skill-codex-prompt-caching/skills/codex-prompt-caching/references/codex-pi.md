# Codex and Pi

Verified **2026-07-31** against:

- OpenAI Codex [`aea26afa`](https://github.com/openai/codex/tree/aea26afaee177d3fe40721ef261a29f89879d505)
- `@earendil-works/pi-coding-agent` / `pi-ai` 0.83.0

Re-trace touched code before implementation. Codex, Pi and backend behavior move faster than static guidance.

## OpenAI Codex

### Request and key

- `codex-rs/core/src/client_common.rs` `Prompt` carries ordered input, tool specs, parallel-call mode, base instructions and optional output schema
- `codex-rs/core/src/session/turn.rs` samples from current complete history and visible tools
- standard Responses sends base instructions in top-level `instructions`, tools in `tools` and history in `input`
- Responses Lite prepends `additional_tools`, then a developer instructions message, then history; top-level `instructions`/`tools` are omitted
- default `prompt_cache_key` is the session ID unless overridden
- HTTP resends full input; WebSocket may send only a delta plus `previous_response_id`

Sources:

- [`client.rs` request construction](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client.rs#L816-L929)
- [`client_common.rs` prompt shape](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client_common.rs#L16-L61)
- [`prompt_cache_key.rs` integration tests](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/tests/suite/prompt_cache_key.rs#L39-L157)

### Prefix stability

- input order is preserved
- tool specs retain planned vector order; tools inside a namespace are name-sorted, but top-level tools are not globally sorted (`core/src/tools/spec_plan.rs`)
- ordinary setting changes append developer context rather than rewrite earlier history
- prompt-caching tests assert stable instructions/tools and repeated history prefix (`core/tests/suite/prompt_caching.rs`)

These tests prove client construction, not a backend cache hit.

### WebSocket continuation

At the pinned revision, Codex sends a delta only when new input strictly extends prior request input plus server output and request properties match. Matching includes model, instructions, tools, reasoning, service tier, cache key and related controls. Otherwise the client sends a fresh full request without `previous_response_id`.

See [`client.rs` request-property checks](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client.rs#L300-L359) and [input extension logic](https://github.com/openai/codex/blob/aea26afaee177d3fe40721ef261a29f89879d505/codex-rs/core/src/client.rs#L1179-L1259).

A client full-request fallback does not prove the backend rejects continuation or that a non-prompt field partitions server prompt-cache KV. Keep client policy, backend capability and measured cache usage separate.

### Compaction and usage

- local compaction installs summary/replacement history (`codex-rs/core/src/compact.rs`)
- resume reconstructs from the newest surviving replacement checkpoint (`core/src/session/rollout_reconstruction.rs`)
- usage maps `cached_tokens` and `cache_write_tokens` into protocol token usage (`codex-api/src/sse/responses.rs`, `protocol/src/protocol.rs`)

Compaction changes the next prefix even when session identity continues.

## Pi request pipeline

Pi 0.83 constructs a provider request in this order:

1. build the base system prompt from custom prompt, active tool snippets/guidelines, context files and skills
2. chain `before_agent_start` handlers in extension load order
3. before each LLM call, chain `context` message transforms
4. serialize system prompt, messages and active ordered tool definitions for the provider
5. chain `before_provider_request` payload transforms in extension load order

`ctx.getSystemPrompt()` does not include `context` mutations or provider-payload rewrites. Inspect the final payload when diagnosing cache behavior.

Stock OpenAI Responses/Codex providers derive `prompt_cache_key` from Pi's session ID and clamp it to 64 Unicode characters. Pi usage separates uncached `input`, `cacheRead` and `cacheWrite`.

Default Pi compaction and branch summarization use a fresh routing ID with cache writes disabled because the summary prompt is one-off. The rebuilt main context is a new prefix.

Relevant package docs: `docs/extensions.md`, `docs/compaction.md`, `docs/session-format.md`, `docs/sdk.md`. In source distributions inspect `packages/coding-agent/src/core` and `packages/ai/src`.

## Pi extension checklist

### Prompt and tools

- trace every `before_agent_start`, `context` and `before_provider_request` handler in load order
- treat active tool names, copy, schemas, grammar, strictness and order as prompt content
- make filesystem/config discovery sorted and deterministic
- keep timestamps, random IDs, host paths and status text out of the early prompt unless required
- expect loaded context files, skills, cwd-sensitive metadata and dynamic tool promotion to change the prefix

### Modes and transport

- fingerprint post-transform payloads, including relocated instructions/tools and normalized images
- compare model, reasoning, service tier, tool mode and transport separately from the token prefix
- require prewarm to match the real request's prompt, tools, reasoning, options and replay
- do not call prewarm or `previous_response_id` a prompt-cache hit

### History and compaction

- classify injected custom/display messages as model-facing or filtered
- preserve tool-call/result pairing, item IDs/types, reasoning signatures and canonical compaction checkpoints
- reset incompatible continuation state after model/provider/mode/history replacement
- treat compaction, branch summaries and tree navigation as new-prefix events

### Evidence

1. capture final initial, tool-continuation, reconnect and post-compaction payloads
2. identify the first provider-rendered divergence
3. inspect `cacheRead`/`cacheWrite` usage against the real backend
4. report client-shape evidence, backend evidence and unknowns separately
