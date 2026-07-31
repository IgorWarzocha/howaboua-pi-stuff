# OpenAI prompt-caching contract

Current as of **2026-07-31**. Recheck the official pages before implementation:

- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Compaction](https://developers.openai.com/api/docs/guides/compaction)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Model catalog and pricing](https://developers.openai.com/api/docs/models)

## Core contract

- Prompt caching is automatic for supported current models when rendered prompt input is at least 1,024 tokens
- Hits require an exact prompt prefix. Put stable instructions/examples first and variable user data last
- Messages, images/files, available tools and structured-output schemas can contribute to cached input
- Images must retain identity/content and `detail`; tools must be identical between requests
- Requests below 1,024 tokens still report `cached_tokens`, but it is zero
- Prompt caching changes prefill cost/latency, not output generation. Nondeterministic requests need not return the same answer
- Caches are organization-scoped, not shared across organizations

“Exact prefix” means the model's provider-rendered prompt token sequence, not JavaScript object identity or top-level JSON key order. Arrays, roles, text, images and tool declarations feed that rendered sequence. The public docs do not expose every provider rendering rule, so deterministic request construction plus measured usage is the practical oracle.

## Routing and `prompt_cache_key`

- OpenAI routes by a hash of the initial prefix, typically the first 256 tokens; exact length varies by model
- `prompt_cache_key` is combined with that hash to improve routing/matching for requests sharing a long prefix
- On GPT-5.6+, a key is required for the newer reliable matching in implicit or explicit mode. Keyless automatic hits may still occur
- Keep aggregate traffic across all prefixes for one key around 15 requests/minute. Stably partition higher-volume traffic

The key does not replace prefix equality. Reusing one key across unrelated prompts can overload routing and does not force a hit. Rotating a key can lose reliable routing even when content is stable.

## GPT-5.6 and later

GPT-5.6 introduces breakpoint-based behavior:

- default `implicit` mode places a breakpoint at the latest user or tool message and also honors explicit breakpoints
- unlike earlier models, it does not fall back to an earlier matching unmarked prefix
- if variable timestamps, history or user content are before the implicit breakpoint, requests can report zero cache reads and repeatedly write that changed prefix
- add `prompt_cache_breakpoint: { "mode": "explicit" }` at the end of stable reusable content and use the same `prompt_cache_key`
- set request-wide `prompt_cache_options.mode: "explicit"` to disable the implicit breakpoint and avoid writes for changing suffixes
- Responses supports markers on `input_text`, `input_image` and `input_file`; Chat Completions supports `text`, `image_url`, `input_audio`, `file` and `refusal`
- one request may create up to four writes; reads consider up to the latest 50 breakpoints. Longest matching breakpoint wins
- markers require at least 1,024 rendered tokens before them to be cacheable
- unsupported blocks or models return `400 invalid_request_error`; capability-gate these fields

Cache writes cost 1.25× uncached input; reads use the model's discounted cached-input price. Compare actual `cache_write_tokens` with later `cached_tokens`; do not assume caching is a net saving.

## Metrics and accounting

Raw OpenAI Responses usage:

```text
usage.input_tokens_details.cached_tokens
usage.input_tokens_details.cache_write_tokens  # GPT-5.6+
```

Chat Completions uses the corresponding fields under `usage.prompt_tokens_details` if that API is touched. Raw `input_tokens` includes tokens read from and written to cache. Current Pi/OpenAI providers normalize this into:

```text
prompt = usage.input + usage.cacheRead + usage.cacheWrite
read ratio = usage.cacheRead / prompt
```

Record model snapshot/alias, provider/API, key, reasoning settings, request mode, final prompt/tool fingerprint, wall time, reads and writes. Cache eviction, routing and TTL make a miss possible even when client payloads match.

## Retention and privacy

- `prompt_cache_options.ttl` sets a **minimum** lifetime, not storage policy or maximum retention
- only `30m` is currently supported and is the default; OpenAI may retain a prefix longer
- encrypted cache tensors are application state and are not retained beyond the documented 24-hour expiration
- ordinary abuse-monitoring logs may contain customer content for up to 30 days; ZDR/MAM require approval
- ZDR forces Responses `store: false`; current data-control docs say non-ZDR organizations use extended caching on supported models
- extended caching in regions without Regional Processing may temporarily process/store customer content outside the selected region

Cache, response state and abuse monitoring have separate controls. For a non-GPT-5.6 model, reopen the current retention table rather than carrying forward another model generation's policy.

## Responses state and compaction

Keep one continuation model:

- **manual/stateless:** resend prior input and append every output item
- **stateful:** send only new input with `previous_response_id`

Do not manually prune while using `previous_response_id`. Server-side compaction emits an opaque encrypted compaction item; retain it in manual history. With standalone `/responses/compact`, pass the complete returned window—including retained items and the compaction item—to the next request as-is.

Compaction reduces context but changes the next rendered prefix. It is a history/cache boundary even if logical task state and cache key continue.
