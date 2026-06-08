# PATH tool builds

This package ships Codex tools as shell commands. Published installs use bundled binaries under `vendor/**/<platform>-<arch>/`.

Architecture: Rust owns tool execution. TypeScript owns Pi registration, model/auth gating, result conversion, and TUI rendering. Keep normal Pi tools and PATH-mode shell tools using the same Rust binaries where practical.

Current Rust-executed Pi tools:

- `apply_patch` via `vendor/apply-patch/**` with `PI_APPLY_PATCH_JSON=1` for structured Pi deltas.
- `view_image` via `vendor/path-tools/**/view_image`.
- `web_run` via `vendor/path-tools/**/web_run`.
- `imagegen` via `vendor/path-tools/**/imagegen`.

Use `src/tools/path-tool-runner.ts` for bundled binary execution from TypeScript glue.

Exec migration staging lives in `vendor/path-tools-src/crates/codex-exec-shim/`. It vendors the reusable Codex PTY/process substrate and a Pi-localized local process table. Keep Codex `core/src/unified_exec/**` out of this crate; that layer is coupled to Codex approvals, sandboxing, sessions, and event types.

Build from `packages/pi-codex-conversion` on the target platform:

```bash
bun run build:apply-patch
bun run build:path-tool codex-view-image view_image
bun run build:path-tool codex-web-run web_run
bun run build:path-tool codex-imagegen imagegen
```

Outputs:

```txt
vendor/apply-patch/<platform>-<arch>/apply_patch(.exe)
vendor/path-tools/<platform>-<arch>/view_image(.exe)
vendor/path-tools/<platform>-<arch>/web_run(.exe)
vendor/path-tools/<platform>-<arch>/imagegen(.exe)
```

Commit the produced binaries for any platform we want to ship. Keep the vendored Rust source in `vendor/apply-patch-src/` and `vendor/path-tools-src/` in sync with the binaries.
