---
name: prompt-cache-awareness
description: "Reviews and designs prompt-cache-aware Pi/OpenAI/Codex changes. Use when changing system prompts, tools, provider payloads, model/reasoning selection, Responses/WebSocket continuity, compaction, dynamic context, or cache metrics."
---

# Prompt-cache awareness

## Mental model

Keep these mechanisms separate:

1. **Provider prompt cache** reuses model prefill for an exact provider-rendered token prefix. It reduces billed input and latency; it does not reuse an answer
2. **Responses continuation** (`previous_response_id`) lets the server carry conversation state. Codex WebSocket delta requests use this when request properties and prior history still match
3. **Transport prewarm** opens/seeds a connection for the expected next request. It helps only when prewarm and real request are equivalent
4. **Pi cache prediction** estimates reuse from earlier usage. It neither queries nor changes provider cache state

A stable cache key cannot rescue a changed prefix. A cache read proves only that some eligible prefix matched, not that the whole request matched. Correct behavior outranks cache reuse.

For current OpenAI rules, read [OpenAI contract](references/openai-contract.md). For Codex, Pi and this monorepo, read [Implementation map](references/codex-pi-map.md). Re-open the linked official docs before implementing API fields, retention or pricing: those contracts are model-versioned and mutable.

## Trace the request actually sent

Do not review source prompt text in isolation. Trace:

```text
Pi prompt inputs
→ before_agent_start handlers in load order
→ active ordered tools + session context
→ context handlers before each model call
→ provider serialization
→ before_provider_request handlers in load order
→ HTTP/WebSocket request
```

In Pi:

- `before_agent_start` may rewrite the system prompt or persist a message once per submitted user turn
- `context` may rewrite a deep copy of messages before every LLM call, including tool continuations
- active tools contribute names, descriptions, schemas and order
- `before_provider_request` sees and may replace the final provider payload; later handlers may still rewrite it
- `ctx.getSystemPrompt()` excludes `context` mutations and provider-payload rewrites

Inspect the final payload at the last practical boundary. Treat logs as sensitive: prompts, tools and history may contain credentials or private data.

## Classify every change

### Provider-rendered prefix

These directly affect reusable prompt content:

- system/developer instructions, examples, AGENTS/context files, loaded skill text
- ordered tool definitions: name, description, schema, strictness, grammar and deferred-tool metadata
- ordered messages and output items, including reasoning signatures, tool calls/results and custom messages
- images or files, their final identity/content and image `detail` after provider transforms
- structured-output schema

The first changed token ends reuse for everything after it. “Same information” is insufficient. Preserve roles, item types, IDs, tool pairing and ordering as well as text.

### Cache/routing lane

Treat provider, API, organization/account, model and cache key as lane identity. Model switches are cold. A `prompt_cache_key` influences routing/matching; it is not a cache namespace that overrides prompt comparison.

Reasoning effort, reasoning context, service tier, tool-choice mode, parallel-call mode and transport may not be prompt tokens. They still partition behavior and can invalidate a client's WebSocket continuation policy. Inspect client comparison separately from backend capability: an adapter may fall back to a full request even when the backend accepts continuation. Treat changes as new operational lanes unless backend usage proves server prompt-cache reuse; do not claim undocumented invalidation or reuse.

### History boundary

Compaction, branch summaries, tree navigation, retries that rebuild history, mode/protocol conversion and provider replay can replace or reshape the leading context. Treat the resulting canonical history as a fresh prefix. A stable session ID across the boundary does not preserve the old prefix.

## Design rules

1. Put stable reusable material first and variable material last when semantics allow
2. Keep prompt construction deterministic: stable section order, newline policy, serialization, discovery results and tool order
3. Never add timestamps, random IDs, counters, absolute host paths, volatile status, unordered filesystem results or environment dumps to an early prompt unless the model needs them
4. Do not reorder existing tools for aesthetics. A deliberate canonical sort causes one cold transition; nondeterministic or per-turn reorder causes continuing misses
5. Treat tool copy/schema edits as prompt changes. Keep active tool sets stable within a work phase; prefer one stable search/deferred-tool surface over repeatedly replacing the full tool list
6. Append changed context after a stable history instead of rewriting old entries when semantically safe. Never preserve stale instructions merely for cache
7. Keep session cache keys stable for requests sharing a prefix and distinct for unrelated/high-volume traffic. Follow provider key length/rate limits
8. Change model or reasoning by durable work phase, not around individual tool calls. Quality-driven switches remain valid; account for a cold/uncertain prompt-cache lane and separately inspect current continuation policy/backend evidence
9. Make prewarm use the exact prompt, ordered tools, reasoning, verbosity, service tier, mode transform and compacted replay expected by the real request
10. Keep display/status records out of model context unless intentionally model-facing. Canonicalize and deduplicate injected state messages
11. After compaction, preserve the returned/rebuilt window exactly according to its protocol. Do not mix manual pruning with `previous_response_id` chaining
12. Do not add provider cache controls to the ChatGPT-backed Codex endpoint merely because the public OpenAI API documents them. Verify backend acceptance and Codex parity first

## Current GPT-5.6 contract

GPT-5.6 and later changed cache behavior and write pricing:

- implicit mode places a breakpoint at the latest user/tool message and does not fall back to an earlier unmarked common prefix
- changing history inside that breakpoint can produce zero reads and repeated paid writes despite a long stable beginning
- explicit breakpoints plus a shared key isolate stable prefixes; `prompt_cache_options.mode: "explicit"` disables the implicit breakpoint
- capability-gate breakpoint/options fields for any other model

Current `pi-codex-conversion` sends a session-derived key but no breakpoint/options fields. It therefore relies on backend implicit behavior. Do not promise reuse of its stable system/tool prefix on GPT-5.6; inspect usage. Adding explicit caching is provider integration work requiring Codex-backend verification, request-shape tests and cost measurement.

## Compaction rules

- Pi's default summarization request is intentionally one-off: fresh routing session ID and disabled prompt-cache writes. Optimize the post-compaction main conversation, not the summary call
- ordinary Pi compaction replaces old history with summary + kept messages; branch summaries also reshape the active prefix
- OpenAI standalone `/responses/compact` output is the canonical next window: pass all returned items as-is
- `pi-codex-conversion` native compaction stores/replays the encrypted checkpoint, filters display-only records, resets transport and prewarms the new window
- post-compaction prewarm establishes continuation for the new prefix; it does not make the old and new prefixes equivalent

## Validate with independent evidence

Capture at least these scenarios when the changed surface can affect them:

1. first user request
2. next request after an assistant/tool exchange
3. retry or WebSocket reconnect/fallback
4. model/reasoning/mode change
5. post-compaction request and resume

Compare final instructions, ordered tools, ordered input items, cache key and continuation-relevant request properties. Then inspect provider usage:

- OpenAI Responses: `usage.input_tokens_details.cached_tokens`; GPT-5.6+ also `cache_write_tokens`
- Pi normalizes usage as uncached `input`, `cacheRead`, `cacheWrite`, `output`; total prompt input is `input + cacheRead + cacheWrite`
- cache-read ratio is `cacheRead / (input + cacheRead + cacheWrite)`, not `cacheRead / input`

Use a controlled prompt over the provider's eligibility threshold, stable timing/key and one changed variable. A fast response is not proof. A request-shape test proves client stability, not a backend hit. Keep permanent tests only for narrow model-visible construction, routing, replay or protocol contracts—not cache-hit tours or exact usage amounts.

## Review output

Report:

- provider/model/API and whether current official rules were rechecked
- stable prefix and first expected divergence
- key, mode, reasoning and transport lane boundaries
- affected Pi hooks/extensions and compaction behavior
- request-shape evidence versus backend usage evidence
- expected cold transitions, remaining unknowns and cost/privacy implications
