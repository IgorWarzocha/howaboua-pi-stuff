---
"@howaboua/pi-codex-conversion": patch
---

Keep Notebook Mode working in standalone Pi without loading the native ZeroMQ addon that crashes Bun. Notebook uses a TypeScript TCP transport to its Deno kernel; no separate Node installation is required.
