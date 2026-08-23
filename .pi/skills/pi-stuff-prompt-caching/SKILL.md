---
name: pi-stuff-prompt-caching
description: "This repo's prompt-cache addendum. Read after a general cache skill when changing Codex transport, Pi hooks, compaction, or cache diagnostics."
---

Before cache work, discover and load an applicable general prompt-caching skill. Read `references/codex-pi-map.md` before changing this repository's conversion, Code Mode, continuation, prewarm, compaction, or prompt-mutating extensions.

Recheck current provider documentation before relying on mutable cache API behavior.

Measure final provider requests and reported usage. Do not infer a cache hit from a stable key, quick response, or a source-level prompt comparison.

Preserve canonical provider-visible history. Append new context when safe; never rewrite earlier tool calls or results to improve cache reuse.
