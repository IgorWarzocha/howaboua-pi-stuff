# Custom tool examples

These are disabled templates. Enable a tool by copying its top-level TOML file and companion directory into `~/.pi/agent/codex-conversion-custom-tools/`, or `$PI_CODING_AGENT_DIR/codex-conversion-custom-tools/` when configured.

## Browser

The `browser` example controls a logged-in Chromium browser through CDP with Codex `web__run`-style operations. Copy `browser.toml` and `browser/` together, then follow `browser/README.md` to expose CDP.

The implementation also supports routing browser operations over SSH, but that surface is disabled and hidden from the agent by default. Enabling it requires configuring allowed hosts and the remote tool path in `browser/browser.mjs`, copying the companion files to each remote host, and switching `browser.toml` to its commented SSH-aware usage.

## Lazy skill loaders

Pi discovers its standard skill folders at startup and advertises every discovered skill to the model. The `skills` example keeps a large global workflow library out of that startup catalog while leaving native Pi skills available:

1. Copy `skills.toml` and `skills/` into the custom-tools directory.
2. Put general-purpose skill packages under `~/.pi/agent/lazy-skills/`, or `$PI_CODING_AGENT_DIR/lazy-skills/` when configured.
3. Keep project-specific SOPs in the repository's normal `.pi/skills/` directory so Pi advertises them for every session in that project.

The nonstandard `lazy-skills` name is deliberate: Pi must not discover those global `SKILL.md` files itself. This example expects that exact folder name. Skills may be direct children or grouped one level deeper by category. `--no-skills` remains available when native skill discovery should be disabled entirely, but it is not required.

The older `more_skills` additive loader remains available and reads the parallel `more-skills/` folder.
