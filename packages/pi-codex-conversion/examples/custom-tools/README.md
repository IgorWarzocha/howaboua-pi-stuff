# Custom tool examples

These are disabled templates. Enable a tool by copying its top-level TOML file and companion directory into `~/.pi/agent/codex-conversion-custom-tools/`, or `$PI_CODING_AGENT_DIR/codex-conversion-custom-tools/` when configured.

## Browser

The `browser` example controls a logged-in Chromium browser through CDP with Codex `web__run`-style operations. Copy `browser.toml` and `browser/` together, then follow `browser/README.md` to expose CDP.

The implementation also supports routing browser operations over SSH, but that surface is disabled and hidden from the agent by default. Enabling it requires configuring allowed hosts and the remote tool path in `browser/browser.mjs`, copying the companion files to each remote host, and switching `browser.toml` to its commented SSH-aware usage.

## Agents

The `agents` example starts persistent explorer and reviewer Pi agents in Herdr panels. Copy `agents.toml` and `agents/` together. Local operation works inside Herdr; remote routing requires explicit installer configuration. See `agents/README.md`.

## Skills

The `skills` example reads Pi's standard global skill directory and the current session's `.pi/skills/` directory:

1. Copy `skills.toml` and `skills/` into the custom-tools directory.
2. Keep global skills under Pi's normal `skills/` directory.
3. Keep repository addenda under the normal `.pi/skills/` directory. A same-named session skill overrides the global one.

The tool lists the catalog or reads one exact skill with its package files. Skills may be direct children or grouped one level deeper by category. No lazy or parallel skill directory is required.
