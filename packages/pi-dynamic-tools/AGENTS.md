# pi-dynamic-tools rules

- Keep this package independent from `pi-codex-conversion` while code mode is experimental.
- Vendored Codex runtime sources track `vendor/code-mode-src/UPSTREAM`; keep Pi-owned changes outside upstream `src` trees.
- Dynamic tools are one TOML file each under `~/.pi/agent/dynamic-tools/`.
- Runtime JavaScript is Codex-shaped: `exec`, `wait`, and freeform methods on `tools`.
- `examples/spawn-agent/reviewer.prompt.md` mirrors `../pi-subagent-review/review.prompt.md`; keep them aligned.
