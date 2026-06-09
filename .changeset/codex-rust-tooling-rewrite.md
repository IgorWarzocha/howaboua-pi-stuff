---
"@howaboua/pi-codex-conversion": major
---

Reworks Codex conversion around bundled Rust tool execution and adds a PATH mode.

- Adds bundled cross-platform Rust binaries for `exec_command`, `write_stdin`, `apply_patch`, `view_image`, `web_run`, and `imagegen`.
- Removes `node-pty` dependency.
- Runs the toolkit through bundled binaries - very likely to help with stability - the tools will crash, but not Pi itself. Also improves maintainability - one implementation for all the tools/modes.
- Adds PATH mode: Pi only exposes `exec_command` and `write_stdin` as JSON-schema tools, while `apply_patch`, `view_image`, `web_run`, and `imagegen` are available as shell commands on an extension-injected internal PATH (no changes to user PATH settings).
- Tweaks to system prompt and JSON schema tool definitions to trim a few tokens here and there.
- Reworks grouped `/codex` settings tabs for General, Tools, OpenAI, Usage, and About, including tool-rendering controls, PATH mode, web search model selection, fast mode, verbosity, cached WebSocket upgrade, native compaction settings, and usage display. Removes the confusing “apply patch for all GPT” switch; proxied providers should be named in scope instead.
- Moves the native OAI compaction out of beta.
