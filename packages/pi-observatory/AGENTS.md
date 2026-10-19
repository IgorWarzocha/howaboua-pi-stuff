Indexing is the only session-file reader. HTTP queries and detail views use SQLite, never source JSONL. File cursor, partial tail, entries, calls, search index and summaries commit atomically. Preserve origin-model attribution across exec/wait snapshots and event identity across copied fork history.

Index and query workers must remain separate from each other and HTTP handling. Measure query latency during ingestion, not just after it. Common overview slices use transactional tallies; keep them equivalent to raw call counts.

Keep /observatory's start-or-reuse, browser-open and link-only flow aligned with /board. The extension only launches the viewer; it must not index in Pi's process. This is private and source-only. Add no model tools, prompts or aggregate dependencies. Do not infer failures from generic error words or call later success proof of recovery. Show unsupported or missing telemetry explicitly.

Sandbox setup selects the base extensions only. Install Observatory into the guest after each snapshot replacement; Pi resolves a local install to that candidate-specific path.
