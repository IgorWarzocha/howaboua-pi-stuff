# Codex provider sync notes

This is the maintainer checklist for syncing the bundled provider with Pi and OpenAI Codex. Preserve Pi's local execution model and only port Codex behavior with a meaningful Pi equivalent.

## Reference baseline

- Pi packages: `0.80.6`
- Codex checkout used for the provider and apply-patch comparison: `e7d0e14172`
- Exact apply-patch source revision: [`src/tools/rust/UPSTREAM.apply-patch`](src/tools/rust/UPSTREAM.apply-patch)

## Implemented portable behavior

- Standard Responses request, retry, error, usage, and terminal-stream handling
- GPT-5.6 Luna, Terra, and Sol model support
- GPT-5.6 Code Mode as an opt-in Beta setting backed by Responses Lite
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

## Monitor on each Codex sync

### Responses Lite model scope

Current behavior is deliberately limited to `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`. Keep the explicit family check until Codex enables Lite for another shipped model. Pi model metadata does not currently expose `use_responses_lite`, so querying the Codex model catalog would add state and network failure modes without improving the current mapping.

Lite applies only to the registered `openai-codex` provider. Additional Responses-compatible providers continue using their existing request contract even when the Beta setting is enabled.

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

Do not force all Pi tools into namespaces yet. Pi exposes flat tool names, so full support requires request translation, streamed call translation, dispatch mapping, replay, and result mapping. Our core names are already unique, while PATH mode avoids schema collisions.

Reconsider when Codex:

- forces namespaces for ordinary first-party tools;
- changes GPT-5.6 training or Lite validation to require them;
- lands the coordinated Responses fixes for collisions and return items.

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

Current Codex uses hosted Responses `web_search` only outside Lite. Image generation and Lite web search are client-executed standalone tools. This package follows the standalone path with `web_run` and `imagegen`.

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

`prompt_cache_key` remains stable for a Pi session. Changing the tool set changes request content and intentionally disables cached WebSocket continuation when the previous request is no longer an exact compatible prefix. Do not claim server-side cache hits from local tests; measure `cached_tokens` against the real backend.

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
