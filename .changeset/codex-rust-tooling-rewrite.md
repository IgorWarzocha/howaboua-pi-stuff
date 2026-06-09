---
"@howaboua/pi-codex-conversion": major
---

Reworks Codex conversion around bundled Rust tool execution and adds a PATH mode.

- Adds bundled cross-platform Rust binaries for `exec_command`, `write_stdin`, `apply_patch`, `view_image`, `web_run`, and `imagegen`.
- Removes `node-pty` dependency.
- Runs the toolkit through bundled binaries - improves maintainability. One implementation for all the tools/modes.
- Adds PATH mode: Pi only exposes `exec_command` and `write_stdin` as JSON-schema tools, while `apply_patch`, `view_image`, `web_run`, and `imagegen` are available as shell commands on an extension-injected internal PATH (no changes to user PATH settings).
- Reworks grouped `/codex` settings tabs for General, Tools, OpenAI, Usage, and About, including tool-rendering controls, PATH mode, web search model selection, fast mode, verbosity, cached WebSocket upgrade, native compaction settings, and usage display.
