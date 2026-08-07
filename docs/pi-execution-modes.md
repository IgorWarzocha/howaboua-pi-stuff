# Notebook Code Mode plan

## Goal

Add **Notebook Code Mode** to `pi-codex-conversion` alongside normal and existing Code Mode. Preserve the current provider-visible `exec` and `wait` surface and every nested capability, while giving JavaScript and TypeScript cells persistent notebook state, Deno APIs, and npm imports.

The first slice is an internal Linux x64 proof on the canonical development server. It does not promise a cross-platform release.

## Product contract

- Notebook Code Mode extends Code Mode; it does not replace or weaken normal or existing Code Mode.
- The provider still sees only `exec` and `wait`.
- Existing nested built-ins, custom tools, deferred discovery, `ALL_TOOLS`, rendering, output handling, and background operations remain available with the same contracts.
- Users continue choosing their own Pi extensions, memory systems, skills, and custom tools. Do not bundle Prime-style continual harness, prompt-note, memory, skill, or subagent systems.
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
- A normal uncaught exception leaves mutations made before the throw in the live kernel, matching notebook behavior. A failed cell does not advance the durable checkpoint; a later successful checkpoint may include those surviving mutations.
- Cancellation sends a kernel interrupt. If the kernel remains busy or suffers a fatal runtime failure, terminate it and restore the last completed checkpoint.
- Runtime recovery only restores notebook data. Never imply that filesystem, network, subprocess, or Pi-tool side effects from an interrupted cell were rolled back.
- Compaction does not reset the kernel. The model prompt states that notebook state survives turns and compaction while the session remains live.

The internal prototype is session-linear. It need not rewind heap state with Pi conversation-tree navigation. It must detect navigation away from the state-owning branch and reset or restore visibly rather than silently attach mismatched notebook state. Do not share a live kernel between forked sessions.

## Checkpoint and restore

Keep the full JavaScript heap live while the session runs. Add best-effort durable checkpoints for top-level data:

1. Ask Deno's Jupyter `complete_request` for global and lexical-scope names.
2. Exclude runtime/bootstrap names and serialize each remaining candidate independently with Deno's supported `node:v8` `serialize` API.
3. Skip functions, closures, promises, imports, weak collections, live resources, and values that fail serialization; retain a concise reason per skipped name.
4. Write one atomically replaced checkpoint and manifest per session. Include schema, Deno, V8, project, and session identity so incompatible state is rejected rather than guessed at.
5. Restore compatible values with `node:v8` `deserialize`, then rebind current tool globals and metadata.
6. Report restored, skipped, failed, or invalidated names visibly to the model.

Use a 256 MiB total prototype cap, with the same cap applied to any single variable. Debounce checkpoints after successful cells and perform a bounded final flush. Replacing one current checkpoint prevents unbounded per-cell history; orphaned session artifacts should be garbage-collected rather than retained indefinitely.

On an orderly mode switch, session switch, reload, or exit, flush the checkpoint and stop Deno. Do not maintain detached daemons or orphan kernels.

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
6. A graceful restart restores serializable variables, reports skipped state, and rebinds current tool metadata.
7. An interrupted cell restores the last completed checkpoint without claiming to reverse external side effects.
8. Normal Code Mode still uses fresh V8 isolates and its existing custom-tool behavior unchanged.

After the proof, decide publication and broader platform support from measured startup latency, checkpoint cost, dependency/install reliability, bridge behavior, and real agent use. Shipping package changes require a focused issue/PR, a changeset, and the repository's changed-package gate.
