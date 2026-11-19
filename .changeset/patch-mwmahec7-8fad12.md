---
"@howaboua/pi-codex-conversion": patch
---

- Fixed TS mode rejecting empty-object help calls accepted by Code and Notebook.
- Code image viewing and binding-conflict errors now give clearer recovery guidance.
- Code and Notebook guidance clarifies binding reuse, patch syntax, rollback limits and restorable hook dependencies.
- Code and Notebook no longer save a second copy of images already included in the tool result.
- QuickJS Code uses Pi's bundled runtime and no longer downloads its own.
- VM Code reports the actual syntax error when a cell with top-level `await` is malformed.
- Codex Responses Lite preserves more screenshot detail, up to Codex's 6,000-pixel and 10,000-patch limits.
- Reduced memory use when preparing image-heavy Codex requests and continuing WebSocket sessions. Remote image validation reuses prepared images across turns.
- Codex honours `Retry-After` in streamed errors and `Retry-After-Ms` in HTTP and streamed errors.
- Codex omits reasoning effort when the model declares the requested level unsupported.
- Auto Reasoning guidance maps effort levels to the work ahead and tells agents to adjust by work phase, not per tool call.
