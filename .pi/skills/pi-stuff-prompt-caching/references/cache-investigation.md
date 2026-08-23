Resolve the exact Pi session and its Pi Codex diagnostics log before searching source. Start from the user's reported transition and time, not the current footer state.

## Capture the evidence

Keep a live session running and visible. Under Herdr, `herdr agent get <target>` reports the canonical session file at `.result.agent.agent_session.value`. Otherwise discover Pi's current session controls from `pi --help` and locate the exact JSONL artifact.

The diagnostics log is under `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/pi-codex-logs/`. Its filename ends with the session JSONL stem, and its header records the full `session_file`. Resolve that one log directly:

```sh
agent_dir=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
session=/exact/session.jsonl
stem=$(basename "$session" .jsonl)
find "$agent_dir/pi-codex-logs" -maxdepth 1 -type f -name "*$stem.log" -print
```

If no exact log exists, do not turn the current status into historical evidence. Ask the user to enable cache diagnostics logging under `/codex` and reproduce the transition. Do not silently change their settings or disturb the original session.

Do not search all stored sessions or dump raw JSONL to find a known live session. Diagnostics are metadata-only. Session records may contain prompts, tool results, voice transcripts, and encrypted provider state.

## Build the request timeline

Read a bounded time range from the diagnostics log. Repeated headers mark the same session being reopened, often under a new model. Pair each `request` with its following `usage` in the same lane and record:

- `lane`, `model`, `transport`, and `attempt`
- `continuation`, `canonical_history`, and `previous_response_id`
- `full_input_items` versus `sent_input_items`
- `input_tokens`, `cache_read`, `cache_write`, and `output_tokens`
- compaction source, replay decision, checkpoint provenance, and rewritten outputs
- prewarm or keepalive kind, request source, strategy, socket lane, and usage authority

Interpret those fields narrowly:

- `cache_read` and `cache_write` are provider evidence. The footer and cache predictor are not historical evidence.
- `previous_response_id=true` proves server continuation, not a provider cache hit.
- `prewarm-ready` proves that prewarm completed. Only usage marked `cache_usage="authoritative"` proves provider reuse for that operation.
- `checkpoint_model` identifies the model that created retained encrypted history. The request's `model` identifies the model actually handling compaction.
- `sent_input_items < full_input_items` is expected for a valid delta. A full resend needs an explained continuation decision.

Extract model changes, assistant usage, and stored compaction diagnostics from the session without printing content or `compactedWindow`:

```sh
since=2026-01-01T00:00:00Z
jq -rc --arg since "$since" '
  select(.timestamp >= $since) |
  if .type == "model_change" then
    {timestamp, type, provider, modelId}
  elif .type == "compaction" then
    {timestamp, type, model: .details.model, usage: .details.usage}
  elif .type == "message" and .message.role == "assistant" then
    {timestamp, type, model: .message.model, usage: .message.usage, stopReason: .message.stopReason}
  else empty end
' "$session"
```

Use the session timeline to order model changes, compaction entries, resumes, and requests. Do not treat persisted session history as the final provider payload.

## Find the first unexplained boundary

Mark deliberate cold boundaries first: model, provider, endpoint, reasoning lane, mode, tool surface, system prompt, explicit reset, and completed compaction changes. Then find the first later request that should have extended the current stable prefix but did not.

Follow the diagnostic reason before comparing arbitrary files:

- A non-`delta` continuation routes to WebSocket continuation and request-property comparison.
- Reconstructed compaction routes first to `compaction_source` and `compaction_replay`, then canonical session state and replay matching.
- A keepalive routes to its captured or reconstructed request source and generated-refresh usage.
- A prompt miss routes through final system instructions, ordered tools, provider-visible input items, and request properties in that order.

Use `codex-pi-map.md` to reach the current owners. Refresh the canonical Codex reference checkout only when parity or divergence matters. Never infer a fault from a stale model name, ready socket, cache key, or UI label alone.

## Test the owning mechanism

Reproduce the smallest persisted boundary that distinguishes the cause. Prefer the repository's serializer, replay, continuation, or compaction helpers over rerunning an entire live session. Compare exact item order and identity, record fail-before and pass-after request sizes or decisions, and add a regression test only for the deterministic project-owned failure.

Finish with the chronological evidence, expected cold boundary, first unexplained miss, owning symbol and mechanism, provider usage impact, counterfactual result, whether the live extension needs reload, and any provider behavior still unverified.
