# Code mode runtime

- This is a self-contained copy of the Pi-owned code-mode bridge from `pi-dynamic-tools`; do not add a runtime dependency on that extension package.
- Keep the copied runtime behavior aligned deliberately, but conversion-specific activation and nested tools belong outside this directory.
- Codex host source and protocol remain pinned under `code-mode/vendor/code-mode-src/`.
- `host-client.ts` owns process/session transport; `host-protocol.ts` validates wire data; `delegate-runtime.ts` owns nested execution; `trace-*` owns bounded trace state.
- `tools.ts` is the registration entrypoint; `shared-runtime.ts`, `public-tools.ts`, and `tool-events.ts` own provider state, Pi tools, and hooks respectively.
- `custom-tools.ts`, `custom-tool-runner.ts`, and `custom-tool-prompt.ts` own TOML discovery, delegated commands, and prompt guidance.
- `tool-result.ts`, `render-tracker.ts`, and `rendering.ts` own their respective output boundaries.
