---
name: pi-stuff-prompt-caching
description: "This repo's prompt-cache addendum. Read after a general cache skill when changing Codex transport, Pi hooks, compaction, or cache diagnostics."
---

Before cache work, discover and load an applicable general prompt-caching skill.

Trace the touched route rather than relying on a versioned map:

- activation and mode selection: `packages/pi-codex-conversion/src/adapter/activation/runtime-plan.ts`
- Pi hooks and cache lifecycle: `packages/pi-codex-conversion/src/extension/events.ts`
- prompt construction: `packages/pi-codex-conversion/src/prompt/build-system-prompt.ts`
- request shape and Code Mode: `packages/pi-codex-conversion/src/providers/openai-codex/request-body.ts` and `responses-lite.ts`
- continuation and prewarm: `packages/pi-codex-conversion/src/providers/openai-codex/websocket-continuation.ts` and `packages/pi-codex-conversion/src/extension/runtime.ts`
- compaction and tool discovery: `packages/pi-codex-conversion/src/adapter/compaction/compaction.ts` and `packages/pi-codex-conversion/src/tools/code-mode/tool-events.ts`

Recheck current provider documentation before relying on mutable cache API behavior.

Measure final provider requests and reported usage. Do not infer a cache hit from a stable key, quick response, or a source-level prompt comparison.

Preserve canonical provider-visible history. Append new context when safe; never rewrite earlier tool calls or results to improve cache reuse.
