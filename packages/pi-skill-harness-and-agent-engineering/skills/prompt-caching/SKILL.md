---
name: prompt-caching
description: "Read before designing, measuring, or debugging prompt-cache behaviour in an agent harness or extension."
last-changed: "2026-08-23"
---

## Define success

Successful prompt caching reuses naturally stable model context without compromising what the model should receive. Cold requests should occur at understandable lifecycle boundaries. Later requests should read the expected stable prefix, process the changed tail normally, and repay writes through real cost or latency savings.

Do not optimize for the highest read percentage. The useful boundary is the longest prefix that should honestly remain unchanged.

Keep these mechanisms separate:

- provider prompt caching reuses model prefill for an exact rendered prefix
- server continuation carries conversation state between requests
- transport prewarm prepares an expected request or connection
- cache prediction estimates reuse but does not inspect provider cache state

A key, stable source object, fast response, prediction, or successful continuation does not prove a provider hit. Use provider-reported reads and writes as final evidence.

## Trace lifecycle and every model call

Cache correctness has two axes: payload identity and snapshot authority. Discover the harness's actual event order, including session start or resume, repeated turn preparation, provider calls, tool continuations, retries, lane changes, navigation, and compaction where present.

1. Map every route that can invoke the model. Ordinary input, extension commands, model-visible messages, synthetic user messages, queued follow-ups, steering, retries, and continuations may run different hooks. Do not infer hook coverage from message role or visibility.
2. Separate adding context from starting work. If work requires fresh prompt or tool state, use a route that performs authoritative preparation.
3. Treat an idle check as an observation, not a reservation. Revalidate at invocation or use an atomic route when freshness depends on a new prepared run.
4. Establish each request, continuation, replay, prewarm, or compaction snapshot's session and lane, capture event, completed hooks, represented provider request, consumer, and invalidators. The authoritative baseline is normally the latest completed final provider request in the current lane. Session-start state is not timeless.
5. Guard asynchronous state so late work from an old lane cannot overwrite newer state.
6. Record every provider call chronologically. An agent turn may contain several. Capture its trigger, lane, continuation state, uncached input, cache reads, cache writes, snapshot provenance, expected stable prefix, and first divergence.
7. Explain the sequence before aggregating it. A series of misses followed by one large hit is broken until explained. Long-term ratios hide when, where, and for whom caching failed.

## Test the user's harness

1. Use isolation to establish only the component's local contract.
2. Reproduce the user's ordinary setup with its real configuration, load order, context, tools, history, and transport.
3. Exercise the natural multi-turn tool loop and lifecycle boundary under investigation.
4. Compare isolated and integrated timelines. Another extension may rewrite the same prompt or session state later.

## Find the first divergence

1. Compare adjacent requests at the last practical boundary before the provider. Exact rendered-prefix identity matters, not semantic equivalence.
2. Find the first change in this order:
   - system and developer instructions
   - ordered tool names, descriptions, schemas, grammar, and activation state
   - ordered messages and provider input items, including roles, types, IDs, tool pairs, files, and images
   - structured-output definitions
   - provider lane and continuation-relevant properties
3. After a tool call, expect an appended assistant call and tool result. If earlier material changes, locate the first changed item rather than blaming the visible tool.
4. Trace the divergence backwards through prompt construction, context transforms, tool discovery, provider serialization, and request-rewrite hooks in their real execution order. Include unrelated extensions.
5. Trace the consumed snapshot to its capture event. Correct content captured too early is stale. A request rebuilt from session-start state can destroy reuse even when the preceding turn was stable.
6. State the owner and mechanism precisely:

> Request N+1 consumed snapshot S from lifecycle event A. Component X later changed Y at event B before the stable boundary, so reuse was lost from that point and continuation did or did not fall back.

7. If ownership cannot be proved, report the narrowest observed boundary and missing evidence.

## Preserve canonical history

The persisted session log and provider-visible history are different contracts. Do not assume the session file equals the wire payload, but do not use that distinction as permission to rewrite the past.

1. Before changing an earlier provider-visible item, prefer returning the correct representation initially, appending new context, keeping state display-only, or waiting for an explicit history boundary. Never rewrite prior tool calls or results merely to integrate an extension.
2. Once an item has been sent, treat its canonical provider representation as immutable within that lane. Preserve roles, item types, IDs, tool-call pairing, order, and content.
3. Make provider transforms filter or convert a copy deterministically on every later request. Capture what was actually sent so replay and compaction do not reconstruct it differently from mutable session state.
4. If malformed history requires repair, perform one deterministic canonical repair and treat the changed prefix as an explained cold boundary. Compaction and branch replacement are explicit history boundaries, not permission for per-turn retroactive mutation.

## Separate presentation from model context

Treat user UI, persisted session state, agent context, and the final provider request as distinct surfaces. Decide the intended audience when creating each record.

- Put cards, status, notifications, and other presentation state through the harness's UI-only mechanism rather than sending a model message and hoping to hide it later
- Do not infer model visibility from a display flag. Hidden records may be authoritative model input, while visible records may be provider-excluded
- When provider exclusion is required, preserve it across ordinary calls, prewarm, compaction, replay, resume, and every other path that reconstructs context
- Inspect each surface independently in the complete environment. Neither the TUI nor session file proves what the model received

Keep UI copy and display metadata out of provider input unless they intentionally inform the agent. Persisting a record does not make it model context.

## Preserve useful stability

After correctness, the final system prompt is the highest-leverage cache invariant an extension controls because an early change invalidates everything after it.

- Do not mutate the prompt when host behaviour, a tool result, or user UI can carry the capability
- Treat inherited prompt text as immutable. Change only the smallest fragment the extension owns
- Use exact lines or owned anchors. If a target is absent or ambiguous, fail visibly rather than normalize or replace a shared block
- Make transforms idempotent and deterministic. Preserve unrelated bytes, ordering, spacing, and newline policy
- Put stable reusable guidance before volatile state when semantics permit
- Capture the latest final provider prompt after relevant hooks, version it by lifecycle lane, and invalidate it explicitly
- Treat meaningful prompt, tool, model, compaction, and history changes as deliberate cold boundaries
- Never retain stale instructions, suppress useful capabilities, or distort the workflow for a cache hit

Recheck the provider contract before implementing cache controls. Public API behaviour does not establish parity for another endpoint or adapter.

## Report behaviour, not a score

Report the chronological request sequence, snapshot provenance, expected and observed stable boundaries, first divergence, owning component, provider usage evidence, economic impact, and whether the transition was deliberate. Separate isolated evidence from full-environment evidence. Ratios and monthly totals may summarize a known-good sequence, but they cannot diagnose one.
