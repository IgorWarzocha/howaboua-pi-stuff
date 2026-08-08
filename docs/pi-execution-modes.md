# Notebook Code Mode plan

## Goal

Add **Notebook Code Mode** to `pi-codex-conversion` alongside normal and existing Code Mode. Preserve the existing `exec` and `wait` behavior and every nested capability, while giving JavaScript and TypeScript cells persistent notebook state, Deno APIs, npm imports, and an external lifecycle control.

The first slice is an internal Linux x64 proof on the canonical development server. It does not promise a cross-platform release.

## Product contract

- Notebook Code Mode extends Code Mode; it does not replace or weaken normal or existing Code Mode.
- Notebook Mode adds one JSON `notebook` tool beside `exec` and `wait`; normal Code Mode keeps its existing two-tool surface.
- Existing nested built-ins, custom tools, deferred discovery, `ALL_TOOLS`, rendering, output handling, and background operations remain available with the same contracts.
- Users continue choosing their own general memory systems, skills, and custom tools. Do not add Prime's continual harness, prompt-note, or subagent systems.
- Notebook cells support natural declarations: top-level variables, functions, classes, and imports persist and may be redefined in later cells.
- Deno APIs and npm imports add a notebook-native computation ecosystem. Prompt the model to keep using Pi/custom tools for project operations where their contracts, rendering, output bounds, or background handles help.
- Notebook Code Mode initially follows the same model/provider eligibility as existing Code Mode and keeps Responses Lite behavior.

Prime remains the answer for users who want its Python/IPython harness. This feature is the JavaScript/TypeScript counterpart shaped around Pi Code Mode, not a port of Prime's product bundle.

## Runtime architecture

Use a pinned Deno Jupyter kernel rather than modifying the existing V8 host.

- Deno supplies maintained TypeScript compilation, top-level await, natural REPL redeclaration semantics, npm imports, rich MIME output, and isolate interruption.
- The extension speaks Jupyter over ZeroMQ. `zeromq` 6.1.2 is already proven by Prime's TypeScript client and adds about 11.3 MB unpacked before transitive installation overhead.
- Lazily download one exact, checksummed Deno release on first Notebook Code Mode use. On Linux x64, Deno 2.9.5 measured 41.6 MB compressed and 95.6 MB installed; this is about 25 MB more download and 49 MB more disk than the current Code Mode host, without inflating the npm package by the binary's full size.
- Start only with Linux x64. A later release may adopt Deno's official macOS, Windows, and glibc Linux x64/arm64 matrix after the prototype contracts hold. Do not claim musl support without an actual distribution path.
- Keep Deno/Jupyter ownership outside the pinned upstream V8 source tree. Reuse Pi-owned nested-tool definitions and custom-tool discovery rather than duplicating their policies.

Deno's kernel closes arbitrary Jupyter `comm_open` targets, so Prime's comm bridge is not reusable. Bootstrap an authenticated loopback bridge into the persistent notebook instead:

- `tools` routes calls to the existing nested-tool adapter.
- `ALL_TOOLS` reflects the current promoted and deferred catalog.
- `text`, `image`, `generatedImage`, `notify`, `store`, `load`, `yield_control`, and other current globals retain their model-facing behavior.
- Refresh tool metadata without restarting the kernel or changing the provider tool schema.
- Bound and validate every bridge request and response; bridge failure is explicit and never falls back to unmediated imitation of a Pi tool.

Deno's ambient filesystem, network, process, and package APIs remain available. This authority is intentional; it does not remove the operational value of Pi's richer tool contracts.

## Cell execution

- One Deno kernel belongs to one active Pi session.
- Every `exec` remains a distinct cell in that kernel, not one never-ending invocation.
- Execute one cell at a time. If a cell has yielded, a second `exec` fails with guidance to call `wait` or terminate the active cell.
- `wait` continues observing the same active cell and preserves its current continuation contract.
- Nested tool promises may run in parallel. At cell completion, cancel and drain only invocations that were fired without being awaited, matching V8 Code Mode rather than letting side effects cross into a later cell.
- A normal uncaught exception leaves mutations made before the throw in the live kernel, matching notebook behavior. A failed cell does not advance the durable checkpoint; a later successful checkpoint may include those surviving mutations.
- Cancellation sends a kernel interrupt. If the kernel remains busy or suffers a fatal runtime failure, terminate it and restore the last completed checkpoint.
- Runtime recovery only restores notebook data. Never imply that filesystem, network, subprocess, or Pi-tool side effects from an interrupted cell were rolled back.
- Compaction does not reset the kernel. The model prompt tells the agent to treat every `exec` as the next Jupyter cell, retain exact working data in named variables, and emit only findings needed in model context.
- Every `exec` and `wait` result reports model-visible V8 heap use against the configured ceiling plus process RSS. Add pressure guidance near the limit rather than hiding an operational constraint in UI-only metadata.

The host-side `notebook` tool keeps emergency controls available when the kernel cannot safely evaluate an ordinary cell:

- `status` reports kernel, memory, checkpoint, and optionally glob-filtered top-level binding state.
- `checkpoint` immediately flushes completed project and session state.
- `release` invokes only standard `Symbol.asyncDispose`/`Symbol.dispose` hooks, checkpoints the named bindings as absent, and restarts when required to clear JavaScript lexical bindings.
- `restart` terminates an active cell if necessary, attempts standard resource disposal, and restores the last completed checkpoint even when disposal fails.
- `diagnostics` starts a one-shot Deno language server outside the kernel, checks the saved `.ipynb`, reports cell-local source errors, then shuts the server down. It never injects automatic diagnostics into `exec` output or keeps an indexer resident.
- `reset` is the explicit disaster path: terminate the kernel, advance the project to an empty generation, discard the current session checkpoint, and start clean while preserving the journal and named profiles. It never replays cells; repaired code runs only through a later explicit `exec`.
- `list`, `save`, and `load` manage global named profiles containing compatible values and helper definitions. Loading refuses binding collisions and forks the profile into ordinary project state; it never shares a kernel or replays cells.

Use JavaScript explicit resource management rather than guessing `.close()`, `.kill()`, or `.abort()` methods. Orderly shutdown also invokes standard disposal hooks after checkpointing and before terminating Deno.

The internal prototype is session-linear. It need not rewind heap state with Pi conversation-tree navigation. It must detect navigation away from the state-owning branch and reset or restore visibly rather than silently attach mismatched notebook state. Do not share a live kernel between forked sessions.

## Project notebook and session recovery

Keep one private live kernel per Pi session, but make its plain top-level state the durable notebook for the Git worktree. Fresh sessions hydrate compatible project state automatically, including sessions started from nested package directories. Do not add repository namespaces, wrapper objects, management globals, or shared live kernels.

Each session forks the latest project generation. Successful checkpoints merge changed top-level names back by generation and value hash; independent names merge, while concurrent changes to the same name preserve the committed value and write a visible conflict artifact instead of applying last-writer-wins. The session checkpoint remains a recovery overlay for that Pi session.

Keep the full JavaScript heap live while the session runs. Add best-effort durable checkpoints for project and session state:

1. Ask Deno's Jupyter `complete_request` for global and lexical-scope names.
2. Exclude runtime/bootstrap names and serialize each remaining candidate independently with Deno's supported `node:v8` `serialize` API.
3. Serialize ordinary values independently. Capture reanimatable function and class source; skip native/bound functions, promises, imports, weak collections, live resources, unsupported closures, and values that fail serialization.
4. Write atomically replaced manifests and payloads for the worktree and session. Include schema, Deno, V8, project, session, generation, and provenance so incompatible or concurrent state is rejected rather than guessed at.
5. Restore values before function/class definitions, then rebind current tool globals and metadata. Never replay cells, tool calls, shell commands, or other side effects.
6. Report actual checkpoint failures to the model without dumping routine skipped-value inventories to the user.

Use a 256 MiB upper prototype cap, reduced to one eighth of the configured heap so serialization plus assembly cannot consume the kernel ceiling; apply the effective cap independently to project and session state and to any single value. Debounce checkpoints after successful cells and await the final flush before orderly teardown. Replacing current checkpoints prevents unbounded per-cell history; tree navigation removes superseded session epochs while retaining project state and `.ipynb` evidence.

Checkpoint before compaction. On an orderly mode switch, session switch, reload, or exit, await the final flush and stop Deno. Do not maintain detached daemons or orphan kernels.

## Activation and configuration

Mode precedence is:

1. latest override on the active Pi session branch;
2. trusted project default from `<cwd>/.pi/pi-codex-conversion.json`;
3. existing global Code Mode configuration and defaults.

The project field is:

```json
{
  "executionMode": "notebook"
}
```

Global Notebook resource configuration lives in `pi-codex-conversion.json`:

```json
{
  "notebook": { "maxHeapMiB": 8192, "profile": "shell" }
}
```

The heap value is a V8 ceiling, not eagerly allocated physical RAM. Default to 4096 MiB and reject values outside 256–65536 MiB. The optional profile loads after project and session recovery only when none of its names collide with restored state.

Valid values are `normal`, `code`, and `notebook`. Read project configuration only when `ctx.isProjectTrusted()` is true and use Pi's `CONFIG_DIR_NAME` rather than hardcoding `.pi` in implementation.

Add a **Session execution mode** selector to `/codex` with inherited, normal, Code Mode, and Notebook Code Mode values. A session selection writes a non-model-facing custom session entry, not the global configuration file. Existing users with `beta.codeMode` retain their inherited behavior. Changing modes resets provider continuation/prewarm state at the intentional prompt/tool-prefix boundary.

## Compatibility boundary

- Do not modify the working vendored V8 Code Mode host for this feature.
- Future V8 resync considerations are tracked separately in [issue #238](https://github.com/IgorWarzocha/howaboua-pi-stuff/issues/238). If that work becomes necessary, resync the complete vendored boundary to one upstream commit rather than cherry-picking into upstream-owned source.
- No V8 sandboxing, resource-limit, or host-transport work belongs in the Notebook Code Mode release.
- Mode-specific prompt copy may change, but normal and existing Code Mode provider schemas, globals, and behavior must remain stable.

## Prototype acceptance

The Linux x64 proof is successful when it demonstrates:

1. Notebook Code Mode activates through a session override or trusted project default without affecting other modes.
2. Notebook Mode receives `exec`, `wait`, and the JSON `notebook` lifecycle tool while normal Code Mode retains only `exec` and `wait`.
3. TypeScript declarations, functions, imports, npm packages, and top-level await persist and can be reused or redefined across cells.
4. Existing built-ins and promoted or deferred custom tools remain discoverable and callable from notebook code, including composed and parallel nested calls.
5. Yield, `wait`, busy rejection, cancellation, ordinary exceptions, and fatal recovery produce actionable model-visible results.
6. Fresh sessions restore compatible plain project globals, including reanimatable helpers; resuming a session layers its compatible recovery checkpoint without invented state namespaces.
7. The session writes a valid `.ipynb` journal containing cell source before execution and bounded outputs afterward, so a hung cell remains diagnosable without exposing journal plumbing as a notebook global.
8. A graceful restart reports incompatible state, rebinds current tool metadata, and does not claim to reverse external side effects.
9. Every Notebook result reports heap/RSS pressure while normal Code Mode still uses fresh V8 isolates and its existing custom-tool behavior unchanged.
10. Lifecycle status, explicit checkpoint, standard resource release, idle restart, and restart around a yielded cell remain available outside `exec`.
11. Named profiles can be listed, atomically saved, loaded without overwrite, reused across projects, and selected as an optional startup default without replaying notebook cells.
12. One-shot diagnostics can inspect a saved notebook while its kernel is unavailable, identify errors by notebook path and cell-local location, and exit without a resident process; reset removes broken durable state without deleting or replaying the journal.

After the proof, decide publication and broader platform support from measured startup latency, checkpoint cost, dependency/install reliability, bridge behavior, and real agent use. Shipping package changes require a focused issue/PR, a changeset, and the repository's changed-package gate.
