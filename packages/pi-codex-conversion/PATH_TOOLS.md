# PATH tool builds

This package ships Codex tools as shell commands. Published installs use bundled binaries beside each tool under `src/tools/<tool>/bin/<platform>-<arch>/`.

Architecture: Rust owns tool execution. TypeScript owns Pi registration, model/auth gating, result conversion, and TUI rendering. Keep normal Pi tools and PATH-mode shell tools using the same Rust binaries where practical.

Current Rust-executed Pi tools:

- `apply_patch` via `src/tools/apply-patch/bin/**` with `PI_APPLY_PATCH_JSON=1` for structured Pi deltas.
- `view_image` via `src/tools/view-image/bin/**`.
- `web_run` via `src/tools/web-run/bin/**`.
- `imagegen` via `src/tools/imagegen/bin/**`.
- `exec_bridge` via `src/tools/exec/bin/**`.

Use `src/tools/path/runner.ts` for bundled binary execution from TypeScript glue.

Rust source lives next to the owning tool in `src/tools/<tool>/rust/`. Shared Rust crates live in `src/tools/rust/crates/`. The workspace root is `src/tools/`.

Build from `packages/pi-codex-conversion` on the target platform:

```bash
bun run build:apply-patch
bun run build:path-tool codex-view-image view_image
bun run build:path-tool codex-web-run web_run
bun run build:path-tool codex-imagegen imagegen
bun run build:path-tool codex-exec-shim exec_bridge
```

Outputs:

```txt
src/tools/apply-patch/bin/<platform>-<arch>/apply_patch(.exe)
src/tools/view-image/bin/<platform>-<arch>/view_image(.exe)
src/tools/web-run/bin/<platform>-<arch>/web_run(.exe)
src/tools/imagegen/bin/<platform>-<arch>/imagegen(.exe)
src/tools/exec/bin/<platform>-<arch>/exec_bridge(.exe)
```

Commit the produced binaries for any platform we want to ship.
