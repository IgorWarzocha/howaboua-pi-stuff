---
"@howaboua/pi-codex-conversion": patch
---

Expand pi-codex-conversion with persistent Notebook Mode, true Fast Mode, project-owned settings, and current Pi/Codex protocol support.

- **Notebook Mode:** Run Code Mode as a persistent Deno/TypeScript Jupyter kernel while keeping the same `exec` and `wait` workflow. Serializable state survives cells and restarts; deliberate bindings can be shared across project sessions without exposing private session scratch.
- **Notebook operations:** Add named reusable profiles, inspect/pin/prune/reset/restart controls, one-shot Deno diagnostics, recoverable `.ipynb` journals, memory telemetry, expandable nested-tool traces, and conflict-aware concurrent project state.
- **Safer notebook dependencies:** Require approval for new exact-version npm imports, show packages already available to the kernel, and lazily install verified Deno 2.9.5 builds on Linux, macOS, and Windows for x64 and ARM64.
- **Real Fast Mode:** Activate ChatGPT Codex priority processing across WebSocket, SSE, prewarm, reconnect, retry, and native compaction while preserving ordinary request identity when Fast Mode is off. Renamed providers and monitoring proxies retain the appropriate Codex transport behavior.
- **Project settings:** Let trusted projects switch `/codex` from global defaults to a complete `.pi/pi-codex-conversion.json` snapshot. Independently launched workers can force Fast Mode without changing other running Pi sessions.
- **Models and tool contracts:** Add gated Daybreak Blue and Daybreak Red cybersecurity models, honor Pi's opt-in strict tool schemas, preserve terminal `end_turn`, and carry namespaced tool identities through stock, renamed, proxy, Code, and Notebook routes.
- **Compatibility and security:** Require Pi 0.84.2 or newer and update Undici to patched 8.10.0.
