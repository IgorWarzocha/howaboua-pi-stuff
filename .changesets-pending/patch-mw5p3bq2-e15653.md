---
"@howaboua/pi-codex-conversion": patch
---

- Updated the Notes migration warning to install Agent Comms.
- Code and Notebook now keep unchanged nested-tool images stable across progress updates.
- Code and Notebook no longer recommend shell or patch bindings missing from their tool catalogue.
- Patch success results omit routine counters. Errors retain partial-change details and recovery instructions.
- Unavailable image viewing and reasoning adjustment now report recovery options.
- Voice task acknowledgements now omit unused task IDs.
- Fixed excessive memory use when comparing large Codex conversation inputs for WebSocket continuation.
- JS Notebook now uses the Pi codemode 1.5.1 runtime.
- Responses Lite proxies now honour `compat.promptCacheKeyMode: "disabled"`.
