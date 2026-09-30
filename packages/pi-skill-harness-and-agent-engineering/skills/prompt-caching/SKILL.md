---
name: prompt-caching
description: "Read before designing, measuring, or debugging prompt-cache behaviour in an agent harness or extension."
last-changed: "2026-09-24"
---

Use provider-reported cache reads and writes as evidence. Continuation IDs, prewarm readiness, predictions, keys, and latency do not prove a hit. Verify the active endpoint and usage mapping rather than assuming public-API parity.

## Locate the first unexplained miss

- For a reported miss, start with the transition and adjacent provider calls, not an aggregate hit ratio. Expand lifecycle coverage when shared state or an explicit audit requires it. An agent turn may contain several requests. Mark deliberate model, reasoning, mode, prompt, tool, compaction, and history boundaries first.
- Compare final provider requests in order: system and developer instructions, ordered tool contracts, ordered input items and their identities, structured-output definitions, then lane and continuation properties. Session logs and source strings are not the wire payload.
- Trace the first divergence backwards through the actual preparation and rewrite chain. Identify the owner and capture event of each consumed snapshot, its completed hooks, lane, consumers, and invalidators. Correct bytes captured before authoritative preparation are stale. Use the latest completed final request in the same lane, not session-start state. Guard against late asynchronous work overwriting a newer lane.
- Adding context and starting a prepared run are different operations. Verify hook coverage for the implicated kickoff and queued paths. An idle check is not a reservation. Use an atomic route or revalidate at invocation.
- Prove the local mechanism in isolation, then exercise the affected multi-turn boundary in the user's complete extension setup. A later extension may change the same prompt, tools, or history.

## Preserve the right context

- Prefer host state, UI, or a tool result over prompt mutation. Change only owned prompt fragments with deterministic, idempotent transforms. Preserve unrelated bytes and order. Fail visibly on absent or ambiguous anchors.
- Never keep stale instructions or suppress useful tools for cache reuse. Treat intended prompt and tool changes as explained cold boundaries, not defects to conceal.
- Never rewrite prior tool calls or results to integrate a capability. Append context or wait for an explicit history boundary. Preserve sent roles, types, IDs, tool pairing, order, and content. Apply provider conversions deterministically to a copy. Retain the actual sent representation for replay and compaction. Malformed-history repair must be canonical and explain its cold boundary.
- Keep UI, persisted state, agent context, and provider input separate. A display flag does not establish model visibility. Use UI-only records for presentation and verify required provider exclusions survive prewarm, replay, resume, and compaction.

Report the request sequence, expected stable prefix, first unexplained boundary, snapshot provenance, owner, provider usage, and cost or latency impact. Separate isolated from integrated evidence. If ownership is unproved, name the narrowest observed boundary and missing evidence rather than inventing a fix.
