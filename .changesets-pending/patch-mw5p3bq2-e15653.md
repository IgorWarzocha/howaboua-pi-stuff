---
"@howaboua/pi-codex-conversion": patch
---

- Updated the Notes migration warning to install Agent Comms.
- Code and Notebook now keep unchanged nested-tool images stable across progress updates.
- Code and Notebook no longer recommend shell or patch bindings missing from their tool catalogue.
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
