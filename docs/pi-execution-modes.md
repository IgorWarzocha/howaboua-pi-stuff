# Notebook Code Mode plan

## Goal

Add **Notebook Code Mode** to `pi-codex-conversion` alongside normal and existing Code Mode. Preserve the current provider-visible `exec` and `wait` surface and every nested capability, while giving JavaScript and TypeScript cells persistent notebook state, Deno APIs, and npm imports.

The first slice is an internal Linux x64 proof on the canonical development server. It does not promise a cross-platform release.

## Product contract

- Notebook Code Mode extends Code Mode; it does not replace or weaken normal or existing Code Mode.
- The provider still sees only `exec` and `wait`.
- Existing nested built-ins, custom tools, deferred discovery, `ALL_TOOLS`, rendering, output handling, and background operations remain available with the same contracts.
- Users continue choosing their own general memory systems, skills, and custom tools. Bundle only thin Notebook guidance for inspecting and deliberately maintaining repository notebook state; do not add Prime's continual harness, prompt-note, or subagent systems.
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
- Compaction does not reset the kernel. The model prompt states that notebook state survives turns and compaction while the session remains live.
- Every `exec` and `wait` result reports model-visible V8 heap use against the configured ceiling plus process RSS. Add pressure guidance near the limit rather than hiding an operational constraint in UI-only metadata.

The internal prototype is session-linear. It need not rewind heap state with Pi conversation-tree navigation. It must detect navigation away from the state-owning branch and reset or restore visibly rather than silently attach mismatched notebook state. Do not share a live kernel between forked sessions.

## Repository baseline and session restore

Per-session persistence alone is a poor fit for repositories where agents start many fresh sessions. Use two layers:

- Every Git worktree has a durable, serializable `repo` namespace that hydrates automatically into each new Notebook session, including sessions started from nested package directories. It carries only deliberately reusable indexes, datasets, decisions, and working notes.
- Ordinary notebook variables remain private to the Pi session. Resuming that session restores its private checkpoint on top of the latest compatible repository baseline.
- Sessions fork repository state; they never share one live kernel. Persist repository updates with generation/provenance checks and preserve conflicts visibly rather than silently applying last-writer-wins.
- Bound repository key count, key size, manifest size, and model-visible inventories independently of serialized value bytes.
- Startup tells the model what repository and session state was restored. A thin bundled skill teaches agents to inspect `repo`, reuse fresh values, and promote only genuinely reusable work.

Keep the full JavaScript heap live while the session runs. Add best-effort durable checkpoints for repository and session data:

1. Ask Deno's Jupyter `complete_request` for global and lexical-scope names.
2. Exclude runtime/bootstrap names and serialize each remaining candidate independently with Deno's supported `node:v8` `serialize` API.
3. Skip functions, closures, promises, imports, weak collections, live resources, and values that fail serialization; retain a concise reason per skipped name.
4. Write atomically replaced manifests and payloads for the repository baseline and each session overlay. Include schema, Deno, V8, project, session, generation, and provenance so incompatible or concurrent state is rejected rather than guessed at.
5. Restore compatible values with `node:v8` `deserialize`, then rebind current tool globals and metadata.
6. Report restored, skipped, failed, or invalidated names visibly to the model.

Use a 256 MiB upper prototype cap, reduced to one eighth of the configured heap so serialization plus assembly cannot consume the kernel ceiling; apply the effective cap to both total state and any single variable. Debounce checkpoints after successful cells and await the final flush before orderly teardown. Replacing one current checkpoint prevents unbounded per-cell history; tree navigation removes superseded private checkpoint epochs while retaining `.ipynb` evidence.

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
  "notebook": { "maxHeapMiB": 8192 }
}
```

The heap value is a V8 ceiling, not eagerly allocated physical RAM. Default to 4096 MiB and reject values outside 256–65536 MiB.

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
2. The provider receives only `exec` and `wait`.
3. TypeScript declarations, functions, imports, npm packages, and top-level await persist and can be reused or redefined across cells.
4. Existing built-ins and promoted or deferred custom tools remain discoverable and callable from notebook code, including composed and parallel nested calls.
5. Yield, `wait`, busy rejection, cancellation, ordinary exceptions, and fatal recovery produce actionable model-visible results.
6. A fresh session automatically restores the compatible repository baseline; an existing session additionally restores its private serializable variables.
7. Repository updates retain provenance and surface concurrent conflicts without overwriting either candidate silently.
8. A graceful restart reports restored and skipped state, rebinds current tool metadata, and does not claim to reverse external side effects.
9. Every Notebook result reports heap/RSS pressure while normal Code Mode still uses fresh V8 isolates and its existing custom-tool behavior unchanged.

After the proof, decide publication and broader platform support from measured startup latency, checkpoint cost, dependency/install reliability, bridge behavior, and real agent use. Shipping package changes require a focused issue/PR, a changeset, and the repository's changed-package gate.
