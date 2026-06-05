# PATH tool builds

This package ships Codex tools as shell commands. Published installs use bundled binaries under `vendor/**/<platform>-<arch>/`.

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
