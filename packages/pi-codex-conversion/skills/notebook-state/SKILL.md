---
name: notebook-state
description: "Notebook Code Mode state reuse: persistent cells, repository baseline, session checkpoints, previous .ipynb journals, memory pressure, and conflict handling. Use when durable computation or prior repository work can avoid repetition."
---

# Notebook state

Use state to avoid recomputing durable workspace knowledge, not to preserve incidental clutter.

## State layers

- `repo` is the serializable workspace baseline automatically loaded into every new session in the same scope. Store deliberately reusable verified commands, artifact pointers, indexes, parsed datasets, and decisions as top-level keys, with provenance when staleness matters.
- Ordinary declarations are private to the current Pi session. Use them for experiments, transient handles, and work that should not seed unrelated sessions.
- Resuming a session restores its private checkpoint over the current compatible repository baseline.

Before rebuilding equivalent state, filter `Object.keys(repo)` and `Object.keys(globalThis)` with selective task-specific terms; never dump either namespace. Inspect only relevant matches. Before finishing, publish compact knowledge when future sessions would otherwise need meaningful rediscovery. Validate freshness against current files, revisions, dependency versions, or other relevant provenance; persisted data is not proof that its assumptions still hold.

## Publishing

Assign reusable serializable values to clear top-level `repo` keys. Keep provenance beside derived data when staleness matters. Do not publish secrets, live handles, promises, functions, subprocesses, temporary output, or large values with no likely reuse.

Repository checkpoints merge independently changed top-level keys. If another session changed the same key, Notebook Mode preserves the candidate separately and reports a conflict rather than overwriting either value. Conflict JSON/binary artifacts live at `notebook.conflictDirectory`; inspect a candidate with `node:v8` `deserialize` only when needed. Resolve deliberately by assigning the chosen value to that `repo` key; its next successful checkpoint clears preserved conflicts for the key. Never hide a conflict with an unrelated assignment.

## Previous notebooks

The global `notebook` object gives the current `journalPath` and project journal `directory`. Journals are standard `.ipynb` files containing prior cell source and bounded outputs.

List and read journals with Deno APIs only when earlier execution history is relevant. Prefer the repository baseline for direct reuse. Treat replay as a deliberate operation: old cells may perform filesystem, network, package, subprocess, or Pi-tool side effects and may no longer be deterministic.

## Memory pressure

Every Notebook `exec` and `wait` result reports V8 heap use and process RSS. Near the heap limit, retain essential serializable work in `repo` or ordinary checkpointable variables, then release unnecessary large values. A kernel restart restores data checkpoints, not functions, imported module internals, live resources, or external side effects.
