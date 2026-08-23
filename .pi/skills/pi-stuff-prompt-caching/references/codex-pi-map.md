Trace the touched route before changing cache-sensitive behavior. These are repository-owned boundaries, not a frozen account of Pi or provider behavior.

## Conversion routing

- `packages/pi-codex-conversion/src/adapter/activation/runtime-plan.ts` selects active conversion, Code Mode, tools, transport, and compaction policy.
- `src/extension/events.ts` maps Pi lifecycle hooks to the prompt, provider request, runtime, and compaction owners.
- `src/extension/runtime.ts` owns prewarm identity and lifecycle. A prewarm request must match the next real request.
- `src/adapter/provider-request.ts` owns provider-payload adaptation around runtime selection and compaction.

Model, provider, execution-mode, configuration, prompt, tool, or compaction-plan changes can alter the rendered prefix or transport lane. Treat them as cold until request and usage evidence proves otherwise.

## Request and continuation

- `src/providers/openai-codex/request-body.ts` owns standard Codex request shape.
- `src/providers/openai-codex/responses-lite.ts` and `responses-lite-tools.ts` own Code Mode's leading tool and developer-input layout.
- `src/providers/openai-codex-custom-provider.ts`, `openai-codex/websocket-stream.ts`, `openai-codex/session-continuity.ts`, and `openai-codex/transport-recovery.ts` own prewarm, WebSocket continuation, replay baseline, and fallback.

Normal and Code Mode have different prompt and tool layouts. Do not claim continuity across that boundary. Preserve the exact request identity required by the current continuation owner. A ready WebSocket is transport state, not proof of provider cache reuse.

## Native compaction

- `src/adapter/compaction/compaction.ts` owns native compaction orchestration.
- `src/adapter/replay/` owns canonical replay reconstruction and matching.
- `src/extension/events.ts` keeps compaction presentation out of provider history.

Treat a compacted window as a fresh provider-history boundary. Preserve item IDs, item types, tool pairing, order, and the canonical replay window. Do not insert status copy into provider-visible history.

## Other cache surfaces

- `pi-dynamic-tools` changes prompt guidance and active tools during agent start.
- `pi-markdown-workflows` changes workflow prompt context.
- Active extension tools change the provider tool vector.
- Model and reasoning controls create lane changes.
- Review, memory, voice, tree, and compaction extensions can append or replace provider-visible history.

Inspect the exact extension owner and final provider request. Do not infer cache behavior from source names, UI prediction, a session key, or a fast response.
