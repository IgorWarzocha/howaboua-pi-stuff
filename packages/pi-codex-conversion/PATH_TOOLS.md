# PATH tools

This package exposes Codex-style tools in two modes.

In normal mode, Codex tools are registered as Pi-native tools with JSON schemas.

In PATH mode, Pi only registers `exec_command` and `write_stdin` as native tools. The other Codex tools are available as shell commands through an extension-injected PATH inside `exec_command`.

This is not the user's shell PATH. The extension prepends bundled commands with `createBundledPathToolsEnv()`, and exec sessions inherit that environment. Agents should call listed commands directly and should not probe them with `which`, `command -v`, `--help`, or version checks.

| Tool | Normal mode | PATH mode |
| --- | --- | --- |
| `exec_command` | Pi-native tool | Pi-native tool |
| `write_stdin` | Pi-native tool | Pi-native tool |
| `apply_patch` | Pi-native tool | shell command |
| `view_image` | Pi-native tool | shell command |
| `web_run` | Pi-native tool | shell command |
| `imagegen` | Pi-native tool | shell command |

## Implementation notes

Rust owns command execution. TypeScript owns Pi integration:

- tool registration
- model/auth gating
- internal PATH env injection
- result conversion
- TUI rendering

Use `src/tools/path/runner.ts` when TypeScript needs to run a bundled binary directly.

Bundled binaries live beside each tool:

```txt
src/tools/apply-patch/bin/<platform>-<arch>/apply_patch(.exe)
src/tools/exec/bin/<platform>-<arch>/exec_bridge(.exe)
src/tools/view-image/bin/<platform>-<arch>/view_image(.exe)
src/tools/web-run/bin/<platform>-<arch>/web_run(.exe)
src/tools/imagegen/bin/<platform>-<arch>/imagegen(.exe)
```

Rust source lives next to the owning tool in `src/tools/<tool>/rust/`. Shared Rust crates live in `src/tools/rust/crates/`. The workspace root is `src/tools/`.

## Maintainer build notes

Published installs use committed binaries. Most changes do not need a local rebuild.

If Rust source changed, rebuild affected local-platform binaries from `packages/pi-codex-conversion`:

```bash
bun run build:changed-path-tools
```

To force all local-platform binaries:

```bash
bun run build:apply-patch
bun run build:path-tool codex-view-image view_image
bun run build:path-tool codex-web-run web_run
bun run build:path-tool codex-imagegen imagegen
bun run build:path-tool codex-exec-shim exec_bridge
```

Commit produced binaries only for platforms we ship. The GitHub Actions binary workflow builds all platforms and uploads artifacts.
