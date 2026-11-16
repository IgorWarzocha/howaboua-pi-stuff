---
"@howaboua/pi-codex-conversion": patch
---

- Added VM Code. JavaScript `let`, `const`, `function` and `class` bindings persist across `exec` calls in the conversation. `exec` and `wait` are unchanged, and tools stay `tools.name`.
- Top-level await is unavailable. Call `tools.name(...).then(...)` or an async function.
- VM Code drops those bindings after a stall, cancellation, memory limit, terminate, or conversation change. The heap is capped at 256 MiB. There is no shared heap, project lock, or checkpoint. QuickJS Code, Code, Notebook and TS are unchanged.
