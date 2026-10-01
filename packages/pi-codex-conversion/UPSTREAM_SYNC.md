# Codex provider sync notes

This is the maintainer checklist for syncing the bundled provider with Pi and OpenAI Codex. Preserve Pi's local execution model and only port Codex behavior with a meaningful Pi equivalent.

## Reference baseline

- Pi SDK baseline: published `0.99.2`
- Stock provider comparison: published Pi `0.99.2` (2026-10-01)
- Codex checkout reviewed through: `1b1835f751ebdc0cfc50b3fe55d4571dbb294563` (2026-09-28)
- WebSocket/session review: `ecc78e4cf5607ecf5f080d682eae0ecb650868ae` (2026-10-01)
- Exact apply-patch source revision: [`src/tools/rust/UPSTREAM.apply-patch`](src/tools/rust/UPSTREAM.apply-patch)
- Exact image utility source revision: [`src/tools/rust/crates/codex-utils-image/UPSTREAM`](src/tools/rust/crates/codex-utils-image/UPSTREAM)
- Standalone web search: [`../pi-codex-web-run/UPSTREAM_SYNC.md`](../pi-codex-web-run/UPSTREAM_SYNC.md)
- Standalone image generation: [`../pi-codex-imagegen/UPSTREAM_SYNC.md`](../pi-codex-imagegen/UPSTREAM_SYNC.md)

## Pi 0.99.1 compatibility

Compared the published SDK and stock Codex provider for request shape, headers, reasoning, service tiers, retries and stream termination. The adapter keeps its existing Codex transport and recovery policy.

- Nested tools preserve Pi's real `ExtensionToolContext`. Startup contexts retain leaf execution but reject Pi-owned nested execution without a parent tool call.
- Code and Notebook modes disable native `codemode` while active and restore its prior activation outside those modes. Their orchestrator tools are model-only. Native MCP tools are admitted by `builtin:mcp` ownership through `prepareLoadout`, keep their Pi callability while their native declarations are hidden, and execute through `ctx.executeTool`. Ordinary extensions retain explicit opt-in integration.
- Responses streams reject unfinished or ambiguous tool calls before execution. Raw provider events reach Pi's observer before normalization on HTTP, WebSocket and prewarm paths. Observer failures do not retry generation or trigger transport fallback.
- Browser OAuth callback errors settle login immediately. The new OpenAI API OAuth provider has separate credentials and does not replace this adapter's Codex backend.
- Backend-reported `fast` uses the existing priority cost multiplier. Stock Pi's Codex provider still recognizes only `priority`; this is an intentional pricing correction.

Pi's built-in GPT-6.1 Sol row maps `minimal` to `low`. Keep the adapter's `minimal: null` override rather than dropping it during catalogue consolidation.

## GPT-6.1 Sol

Model registration follows the [published model specification](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [Codex catalogue at `b1e72963c3b7`](https://github.com/openai/codex/blob/b1e72963c3b71a9265a551e54beff078384efed9/codex-rs/models-manager/models.json). The Codex catalogue confirms Responses Lite, native reasoning updates and a 272K default context window. Keep that default distinct from the public API's 1.05M window. API-equivalent pricing includes the 5% cache-read rate and long-context tier.

Pi exposes `low`, `medium`, `high`, `xhigh` and `max`, with neither `off` nor `minimal`. The catalogue's `ultra` automatic-delegation mode is not exposed through Pi's reasoning selector.

## September 28 transport sync

Reviewed 642 Codex commits after `8ace915aced81ed841e34fa069b2e489c324731c`. The portable changes are:

- HTTP `Retry-After` seconds and dates become monotonic deadlines before response hooks or body parsing. Advice survives request retries and stream recovery, with expired deadlines yielding zero delay. Pi retains its three-minute recovery limits and fails rather than retrying early (`9d8de196748b`).
- `flex_unavailable` is terminal for both streamed error shapes, with a capacity message when the server supplies none (`dafb133c5b7f`).
- Ordinary warmup reuses an already prepared, live socket without another `generate: false` request. Route/auth validation, the complete extension preparation chain, final-body capture and exact continuation checks still run. Compaction warmup and isolated keepalive are unchanged (`a98a07759a3f`, `d838c2346d05`).

Stock Pi `0.87.0` was compared for request shape, headers, reasoning/service tier, retries and stream termination. This adapter intentionally keeps Codex's fresh-request WebSocket recovery and its existing three-minute throttling budgets rather than stock Pi's retry defaults. No request-schema or prompt changes accompany this transport sync.

Responses Lite steering and history-aware main-lane idle prewarm remain separate integration work; neither is equivalent to Pi's current steering or isolated captured-prefix keepalive. Native executor, sandbox and rollout changes have no direct port in this sync. Vendored native source revisions remain independently pinned above.

## October 1 WebSocket preparation

Compared Codex's handshake overlap, cached-session repair, readiness and history-aware warmup changes (`ce7df3623757`, `d838c2346d05`, `f5f08c54cb7a`, `a98a07759a3f`, `3f4668da20a5`) with the current Pi callers.

- With the existing cached-WebSocket policy, handshake acquisition overlaps final asynchronous payload rewrites and Responses Lite image preparation. Pi has already completed the full `before_agent_start` chain and context conversion. This is not Codex's parallel tool discovery. Only the handshake overlaps preparation. Warmup still awaits the authoritative final request in `beforeRequestSend`.
- Handoff revalidates endpoint, account, credentials, proxy and handshake headers. Negotiated beta features participate in socket identity. Cancelled or mismatched preparation closes its lease without advancing continuation or canonical history.
- Transport reset and session shutdown also cancel preparation handshakes that have not yet entered the socket cache. Handoff retires the preparation's lifecycle registration.
- Handshake `426` and close `1009` retain immediate sticky SSE fallback only when the finalized route still matches the failed attempt. Other speculative failures leave normal request recovery in charge.
- Repeated compaction warmup checks the live cached session instead of trusting a past request key. Matching ready history sends no warmup. Extended history can use a validated `previous_response_id` delta, while changed request settings or disconnected sockets require a full request.

Ordinary ready-socket skipping and the default `forceCachedWebSockets: true` policy are preserved. No new idle warmup caller or model generation is added. Isolated keepalive remains unchanged.

Pi `0.99.2` queues steering input between completed responses rather than interrupting an active generation. Codex's `response.interrupt` and interrupted-terminal handling (`12de0e395d33`) therefore have no current Pi caller. Stock Pi's request shape, headers, reasoning, service tier, retry and stream termination were compared again. The adapter retains its documented transport recovery policy.

Deterministic protocol checks establish handshake overlap, final prompt/tool capture, route handoff, cancellation and warmup repair. They do not establish provider cache hits or a latency improvement.

## Implemented portable behavior

- Standard Responses request, retry, error, usage, and terminal-stream handling
- Chronological system sections and tool declarations, collapsed for models without mid-conversation system messages
- Prompt/tool checkpoints across Pi compaction and context-window cuts
- GPT-6.1 Sol, GPT-6 Astra, Sol and Luna, plus GPT-5.6 Luna, Terra and Sol model support
- Code and Notebook modes backed by Responses Lite on eligible models
- Lite instructions and tools represented as input items
- Lite all-turn reasoning context and standalone tools
- Lite image validation and resizing
- Lite-aware native compaction
- Serial Lite tool calls as required by the backend
- Session/thread identity in headers and client metadata
- Per-turn `x-codex-turn-state` capture and replay
- Cached WebSocket continuation using raw `response.output_item.done` items
- `generate: false` WebSocket prewarming
- zstd SSE requests and stale WebSocket rotation

Idle keepalive refreshes the last finalized provider-request prefix on an isolated socket. It retains all extension rewrites, reacquires matching account credentials, and excludes the latest generated assistant tail rather than rebuilding or appending raw response items. Session, model, transport, and configuration changes invalidate that capture.

Pi projects forced prompts onto requests without recording them in the transcript. Final-request capture retains that effective prompt for native compaction; transcript replay uses the persisted structured sections. `SystemMessage.replace` is no longer part of the upstream contract.

Live cache/compaction validation used source commit `e4c75a732`; it has not been repeated against published Pi `0.99.1`. Isolated SDK captures verify final prompts and tools, not provider cache hits.

## Monitor on each Codex sync

### Responses Lite model scope

The explicit Lite allowlist covers GPT-6 Astra, Sol and Luna, GPT-5.6 Luna, Terra and Sol, and Daybreak Blue/Red aliases. Pi model metadata does not expose `use_responses_lite`; do not add startup catalogue fetches solely for this gate.

The live Codex catalogue verified GPT-6 Sol and Luna with `use_responses_lite` and `supports_reasoning_effort_updates` enabled, 272K default context and 872K maximum context. Both completed live Lite requests and native reasoning updates through this adapter. Cost metadata follows [published Standard API rates](https://developers.openai.com/api/docs/pricing), including cache writes and the long-context tier above 272K input tokens. Reserve and generated keepalive retain their existing GPT-5.6 contracts.

Built-in Lite follows the `openai-codex-responses` transport, including renamed providers. Explicitly configured `openai-responses` proxies may opt into Lite for GPT-6 Astra/Sol/Luna, GPT-5.6 Luna/Terra/Sol and the `gpt-5.6` alias; those routes own backend compatibility and use this package's provider overlay.

Check:

- `codex-rs/models-manager/models.json`
- `use_responses_lite` references in `codex-rs/core`
- `src/providers/openai-codex/responses-lite.ts`

### Parallel Lite tool calls

Official Codex forces `parallel_tool_calls: false` under Lite. Live backend verification confirmed that requests carrying the Lite marker are rejected when this field is `true`, so the package always disables it under Lite.

When checking upstream, inspect the request builder and `responses_lite_sets_all_turns_context_and_disables_parallel_tool_calls` coverage. Reconsider only if Codex and the backend both enable parallel Lite calls.

### Tool namespaces

Codex supports namespace tool schemas:

```json
{
  "type": "namespace",
  "name": "web",
  "description": "Tools in the web namespace.",
  "tools": [{ "type": "function", "name": "run" }]
}
```

Current Codex groups ordinary function and custom tools under the default `functions` namespace for Responses Lite while leaving standard Responses flat. The backend omits that implicit default namespace from returned calls but returns non-default namespaces explicitly. This package treats that shape as part of the Responses Lite protocol across stock, renamed, and explicitly configured proxy routes; provider identity does not flatten it. Namespace metadata is preserved through streamed calls, replay, the V8 host, and the Notebook bridge. Existing JavaScript aliases such as `web__run` retain their spelling while routing as `{ namespace: "web", name: "run" }`.

Pi's structured registry still identifies and dispatches tools by one globally unique flat name. Full arbitrary namespace registration therefore belongs in Pi core; do not claim collision-safe direct tools or synthesize extension namespaces in this package.

Relevant Codex areas:

- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/tools/src/responses_api.rs`
- `codex-rs/core/src/tools/router.rs`

### Tool call and return items

Current supported outputs are `function_call_output` and `custom_tool_call_output`, with text or structured content containing text, images, or encrypted content. Namespaced calls can carry `namespace` separately from `name`.

Do not invent a migration based on comments alone. Revisit when Codex changes the serialized call/output items or removes its compatibility handling. Verify:

- call IDs and item IDs;
- namespace preservation;
- output text versus content arrays;
- custom tool outputs;
- tool-search outputs;
- replay after compaction and WebSocket continuation.

### Hosted tools

Current Codex uses hosted Responses `web_search` only outside Lite. Image generation and Lite web search are client-executed standalone tools. The separate `pi-codex-web-run` and `pi-codex-imagegen` extensions follow those standalone paths and compose into Code Mode through its extension-tool bridge.

Do not add hosted file search, code interpreter, computer use, MCP, or image generation merely because the wider Responses API offers them. Reconsider only when Codex itself exposes them through the same model/provider path.

Relevant Codex area: `codex-rs/core/src/tools/hosted_spec.rs` and `hosted_model_tool_specs` in `spec_plan.rs`.

### Reasoning context

Lite currently sends `reasoning.context: "all_turns"`; classic Responses omits it and uses the backend default. Track request-builder and compaction changes. Preserve this distinction unless Codex changes it concretely.

### Transport markers

Track both:

- HTTP/SSE: `x-openai-internal-codex-responses-lite: true`
- WebSocket `client_metadata`: `ws_request_header_x_openai_internal_codex_responses_lite: "true"`

Also check `x-codex-turn-state`, WebSocket metadata event names, session/thread headers, prewarm `generate`, and `previous_response_id` behavior.

### Prompt caching and custom tools

`prompt_cache_key` remains stable for a Pi session. Live backend checks confirmed that one Codex WebSocket can continue across model and reasoning changes with `previous_response_id`, so this package excludes those generation settings from its continuation comparison while still requiring every other request property and the serialized input prefix to match. This reduces transport latency but does not transfer prompt-cache discounts: models and reasoning levels maintain separately warmed cache lanes. Changing the tool set changes request content and disables continuation when the previous request is no longer an exact compatible prefix. Measure `cached_tokens` against the real backend rather than inferring server cache hits from local request shape.

### Responses compaction

Compaction uses V2 through the active model's ordinary streamed Responses provider. Codex also deliberately attempts previous-model compaction during model transitions. Keep these invariants aligned with Codex:

- the first checkpoint receives the full active transcript; later checkpoints receive the previous opaque window plus its exact live tail;
- the stable session `prompt_cache_key`, active tools, instructions, reasoning, service tier, and text options use the normal Responses request shape;
- merge the `remote_compaction_v2` feature header and append `compaction_trigger` as the final input item;
- require a completed stream with exactly one canonical encrypted compaction item;
- remove orphan tool outputs before transport and preserve the contiguous-tail trimming rule;
- retain newest real user messages within the shared approximate 64k-token budget while excluding injected context;
- clear cached continuation state after success and fall back from WebSocket to SSE;
- recursively compact the shared opaque Responses checkpoint item; accept legacy V1 checkpoint strategy metadata only for existing-session replay.

The client uses the registered Codex stream or this package's raw-item-aware standard Responses stream. This preserves request shaping and authentication while ensuring the streamed checkpoint can be validated. Pi owns the checkpoint entry, provider-payload replay, and fallback to Pi summarization. Pi also decides when `session_before_compact` fires; do not disguise that lifecycle difference with model-window mutation. Frontier compaction is not part of this implementation.

## Intentionally excluded

These have no honest Pi equivalent or belong to OpenAI's runtime and telemetry infrastructure:

- installation and window IDs;
- Codex turn metadata blobs;
- parent-thread and subagent metadata;
- rollout and experiment telemetry;
- remote execution and sandbox-server metadata;
- attestation;
- Codex tracing infrastructure;
- filesystem rollback or checkpoint restoration.

Do not fabricate these values. Add one only when Pi owns the corresponding lifecycle concept and the backend behavior is understood.

## Live smoke checks

Code-mode host source and protocol are tracked separately in [`code-mode/UPSTREAM_SYNC.md`](code-mode/UPSTREAM_SYNC.md). The conversion package owns its copied TypeScript bridge and activation boundary; do not replace them with a runtime dependency on another Pi extension.

After a material transport sync, verify against OpenAI Codex OAuth:

1. Classic Responses over SSE.
2. Classic Responses over cached WebSockets.
3. GPT-5.6 Code Mode over SSE with freeform `exec` and function `wait`.
4. GPT-5.6 Code Mode over cached WebSockets.
5. A nested shell call followed by its custom-tool result in the same user turn.
6. A yielded code cell resumed through `wait`.
7. Native compaction under the Code Mode transport.
8. A valid, oversized, malformed, and remote image.
9. WebSocket prewarm followed by `previous_response_id` continuation.
10. Cache-read usage before and after changing the active tool set.

Keep backend observations separate from inferences. A request succeeding does not prove sticky routing or a prompt-cache hit; use returned headers, usage fields, and wire captures where available.
