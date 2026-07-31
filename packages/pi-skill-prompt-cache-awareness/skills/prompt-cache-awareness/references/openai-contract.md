# OpenAI prompt-caching contract

Current as of **2026-07-31**. Recheck the official pages before implementation:

- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Compaction](https://developers.openai.com/api/docs/guides/compaction)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Model catalog and pricing](https://developers.openai.com/api/docs/models)
- [Historical 2024 launch post](https://openai.com/index/api-prompt-caching/)

## Core contract

- Prompt caching is automatic for eligible recent models (`gpt-4o` and newer) when rendered prompt input is at least 1,024 tokens
- Hits require an exact prompt prefix. Put stable instructions/examples first and variable user data last
- Messages, images/files, available tools and structured-output schemas can contribute to cached input
- Images must retain identity/content and `detail`; tools must be identical between requests
- Requests below 1,024 tokens still report `cached_tokens`, but it is zero
- Prompt caching changes prefill cost/latency, not output generation. Nondeterministic requests need not return the same answer
- Caches are organization-scoped, not shared across organizations

“Exact prefix” means the model's provider-rendered prompt token sequence, not JavaScript object identity or top-level JSON key order. Arrays, roles, text, images and tool declarations feed that rendered sequence. The public docs do not expose every provider rendering rule, so deterministic request construction plus measured usage is the practical oracle.

The 2024 launch post documented cache lengths starting at 1,024 and increasing in 128-token increments. The current guide no longer states an increment. Treat 128 as historical, not a current invariant.

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
- unsupported blocks or models return `400 invalid_request_error`; older models reject breakpoint/options fields

Cache writes on GPT-5.6+ cost 1.25× uncached input; reads use the model's discounted cached-input price. Earlier-model writes have no additional fee. Compare actual `cache_write_tokens` with later `cached_tokens`; do not assume caching is a net saving.

## Metrics and accounting

Raw OpenAI Responses usage:

```text
usage.input_tokens_details.cached_tokens
usage.input_tokens_details.cache_write_tokens  # GPT-5.6+
```

Chat Completions reports the corresponding fields under `usage.prompt_tokens_details`. Raw `input_tokens` includes tokens read from and written to cache. Current Pi/OpenAI providers normalize this into:

```text
prompt = usage.input + usage.cacheRead + usage.cacheWrite
read ratio = usage.cacheRead / prompt
```

Record model snapshot/alias, provider/API, key, reasoning settings, request mode, final prompt/tool fingerprint, wall time, reads and writes. Cache eviction, routing and TTL make a miss possible even when client payloads match.

## Retention and privacy

### GPT-5.6+

- `prompt_cache_options.ttl` sets a **minimum** lifetime, not storage policy or maximum retention
- only `30m` is currently supported and is the default; OpenAI may retain a prefix longer

### Earlier models

- `prompt_cache_retention: "in_memory"` generally survives 5–10 minutes of inactivity, maximum one hour, in volatile GPU memory
- supported models may use `24h` extended retention; current eligible models are listed in the guide
- extended retention offloads key/value tensors to GPU-local storage, not original prompt text
- `gpt-5.5` and `gpt-5.5-pro` accept only `24h`
- for models supporting both policies, non-ZDR organizations default to `24h`; ZDR organizations default to `in_memory`

Data controls add important context:

- encrypted cache tensors are application state and are not retained beyond the documented 24-hour expiration
- API data is not used for training unless the customer opts in
- ordinary abuse-monitoring logs may contain customer content for up to 30 days; ZDR/MAM require approval
- ZDR forces Responses `store: false`; non-ZDR organizations use extended caching on supported models
- extended caching in regions without Regional Processing may temporarily process/store customer content outside the selected region

Do not equate “prompt text is not persisted in extended cache storage” with “the API stores no customer content.” Cache, response state and abuse monitoring have separate controls.

## Responses state and compaction

Keep one continuation model:

- **manual/stateless:** resend prior input and append every output item
- **stateful:** send only new input with `previous_response_id`

Do not manually prune while using `previous_response_id`. Server-side compaction emits an opaque encrypted compaction item; retain it in manual history. With standalone `/responses/compact`, pass the complete returned window—including retained items and the compaction item—to the next request as-is.

Compaction reduces context but changes the next rendered prefix. It is a history/cache boundary even if logical task state and cache key continue.
