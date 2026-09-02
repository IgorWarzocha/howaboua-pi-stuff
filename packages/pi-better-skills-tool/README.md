# @howaboua/pi-better-skills-tool

Progressive skill discovery for Pi, Code Mode and Notebook Mode. The `skills` tool lists the active catalog by category, reads one skill, or reads selected references without loading an entire package into context.

## Install

```bash
pi install npm:@howaboua/pi-better-skills-tool
```

Install `@howaboua/pi-codex-conversion` too for Code Mode and Notebook Mode. The extension remains a normal Pi tool when Codex conversion is absent.

## Start Pi without native skills

This setup assumes agent sessions start with `--no-skills`. Pi then omits its native skill catalog from the initial prompt, while the `skills` tool owns progressive discovery. Without the flag, the extension still works but treats Pi's already-loaded catalog as authoritative.

Our wrapper adds `--no-skills` to agent sessions and passes every supplied Pi argument through unchanged. Package-management and configuration commands bypass the flag:

```zsh
#!/usr/bin/env zsh
set -euo pipefail

real_pi="$HOME/.cache/.bun/bin/pi"

case "${1-}" in
  install|remove|uninstall|update|list|config|auth)
    exec "$real_pi" "$@"
    ;;
  *)
    exec "$real_pi" --no-skills "$@"
    ;;
esac
```

Put the wrapper earlier on `PATH` than the real Pi executable. Change `real_pi` when Pi was installed somewhere other than Bun's global binary directory. Quoted `"$@"` preserves each argument exactly, including spaces and repeated flags.

## Use

Normal Pi uses one structured `command` parameter. Code Mode and Notebook Mode use the compact string surface:

```js
await tools.skills("list")
await tools.skills("list code session")
await tools.skills("read code-review")
await tools.skills("read codebase-hygiene testing js-ts")
```

Pi's loaded skill catalog is authoritative during normal use. When Pi has no loaded skills, including `--no-skills` sessions, the tool falls back to the standard global `skills/` directory under Pi's agent directory and `$PWD/.pi/skills/`. A same-named session skill overrides the global skill. Reads return the requested Markdown and absolute package paths for later reference, script, or asset access.

Remove or disable any legacy `codex-conversion-custom-tools/skills.toml` after installing this extension. Keeping both definitions gives Code Mode two tools named `skills`, which it rejects.

The Code Mode surface is freeform because its input is already a compact routed command. It does not add a provider grammar. Code Mode's outer `exec` grammar remains the only constrained grammar involved.
