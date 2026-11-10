---
"@howaboua/pi-codex-conversion": patch
---

- Code and Notebook now keep unchanged nested-tool images stable across progress updates.
- Code and Notebook guidance now follows the available nested tools instead of recommending absent shell or patch bindings.
- General guidance now asks for direct, supported conclusions, with caveats only when they change the answer or next action.
- Uncollected background shell completions now wake idle agents without interrupting active work.
- Compaction and rollover now restore a background-shell inventory in late runtime context without changing the standing prompt.
- Patch success results omit routine counters. Errors retain partial-change details and recovery instructions.
- Unavailable image viewing and reasoning adjustment now report recovery options.
- Voice task acknowledgements now omit unused task IDs.
- Reduced temporary memory use when checking Codex conversation continuity and preparing WebSocket requests.
- JS Notebook now uses the Pi codemode 1.5.2 runtime.
- TS notebooks now use tsrs 0.23, including upstream fixes for memory growth during repeated compiler rebuilds.
- Code now uses the official 0.167 host runtime.
- Bundled native tools and voice helpers now use refreshed Rust dependencies.
- Responses Lite proxies now honour `compat.promptCacheKeyMode: "disabled"`.
- Notebook, compaction metadata and usage reset dates now use minute precision.
