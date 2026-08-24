Resolve the canonical OpenAI Codex repository and refresh a read-only reference checkout before making parity or divergence claims. Use the repo-relative routes below. Current source and tests win over this map.

## OpenAI Codex

- `codex-rs/core/src/client_common.rs` owns the assembled `Prompt`.
- `codex-rs/core/src/session/turn.rs` builds the next prompt from current history and visible tools.
- `codex-rs/core/src/client.rs` builds Responses requests, derives the prompt-cache key, compares request properties, and decides whether input is a strict extension eligible for `previous_response_id`.
- `codex-rs/core/src/tools/spec_plan.rs` owns the provider-visible tool plan and ordering.
- `codex-rs/core/tests/suite/prompt_caching.rs` and `prompt_cache_key.rs` prove Codex client construction. They do not prove a provider cache hit.
- `codex-rs/core/src/compact.rs` and `session/rollout_reconstruction.rs` own local compaction and resumed history reconstruction.
- `codex-rs/codex-api/src/sse/responses.rs` maps provider cache-read and cache-write usage.

Compare this repository with the relevant current Codex owner when request shape, tool order, keying, continuation invalidators, compaction, or usage accounting changes. Record intentional divergence instead of preserving an obsolete local imitation.

## Pi core

Resolve the installed `@earendil-works/pi-coding-agent` and `pi-ai` versions. Read their current extension, compaction, session, and SDK docs, then trace the corresponding source under `packages/coding-agent/src/core` and `packages/ai/src`.

Confirm the active lifecycle rather than assuming an old hook order. Inspect system-prompt assembly, active tool registration, every `before_agent_start` and `context` transform, provider serialization, every `before_provider_request` transform, compaction, replay, and usage normalization.

## Pi Codex Conversion

- `packages/pi-codex-conversion/src/adapter/activation/runtime-plan.ts` selects conversion, Code Mode, tool surface, transport, and compaction policy.
- `src/extension/events.ts` maps Pi lifecycle hooks to prompt, provider-request, context, runtime, and compaction owners.
- `src/extension/runtime.ts` owns prewarm identity and lifecycle. A prewarm request must match the next real request it prepares.
- `src/adapter/provider-request.ts` adapts the final provider payload around runtime selection and compaction.
- `src/providers/openai-codex/request-body.ts` owns the normal Codex request.
- `src/providers/openai-codex/responses-lite.ts` and `responses-lite-tools.ts` own Code Mode's leading developer input and tool layout.
- `src/providers/openai-codex-custom-provider.ts`, `openai-codex/websocket-stream.ts`, `session-continuity.ts`, and `transport-recovery.ts` own transport, replay baseline, continuation, and fallback.
- `src/adapter/compaction/compaction.ts` owns native compaction orchestration. `src/adapter/replay/` owns canonical replay reconstruction and matching.

Normal and Code Mode intentionally have different prompt and tool layouts. Do not claim continuity across that boundary. A ready WebSocket is transport state, not provider cache evidence. Preserve canonical replay item IDs, types, tool pairing, and order after compaction.

## Other local cache surfaces

- `pi-dynamic-tools/src/tools.ts` mutates the system prompt during `before_agent_start`.
- `pi-unicode-charts/src/index.ts` appends chart instructions when the session has a UI.
- `pi-gippity-control/src/register.ts` filters provider-visible messages in `context`.
- `pi-smart-btw/index.ts` removes legacy model-facing state records in `context`; current BTW state is display-only.
- `pi-subdir-agents/src/core/subdir.ts` appends nested `AGENTS.md` guidance to relevant tool results rather than changing the system prompt.
- `pi-gpt-switcher` changes model lanes.
- `pi-cache-hit-predictor/index.ts` predicts reuse and rebuilds around compaction. Its UI is not provider evidence.
- Every active registered tool changes the ordered provider tool surface. Inspect conditional activation and the final serialized vector.

For a cache regression, compare initial, tool-continuation, reconnect, mode-transition, and post-compaction requests as applicable. Separate provider-cache evidence, server continuation, transport prewarm, and UI prediction.
