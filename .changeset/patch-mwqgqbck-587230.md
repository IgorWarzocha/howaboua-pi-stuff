---
"@howaboua/pi-codex-conversion": major
---

- Removed the Voice only setting. Existing configurations now follow Provider scope. Use GipPity Control instead of Pi Codex Conversion for voice without the Codex adapter.
- Removed standalone `apply_patch`, standalone `view_image` and the Extra tools only scope. Existing Extra tools only settings now use Codex and configured providers. Both tools remain available through the Codex adapter.
- Removed Deno Notebook. The old mode setting selects TS Notebook without importing Deno state or activating its saved profile. [Recover or remove old notebook files](https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/main/docs/deno-to-ts-notebook.md) with the repository's copy-paste prompts.
- Replaced QuickJS Code with VM Code. Existing settings select VM Code, which keeps JavaScript bindings for the conversation and runs one cell at a time. Select Code for fresh cells.
- VM Code works in standalone Pi on Linux, macOS and Windows. Bun runs in a separate process with a hard cgroup memory limit on Linux and a memory watchdog on macOS and Windows.
- Codex falls back to HTTP for the session when a request exceeds the advertised WebSocket limit or the server closes with code 1009 before sending text.
- Codex reports an incomplete response without replaying it when a WebSocket size rejection follows visible output.
- Removed the Harness identifier header setting. Codex requests now always send `codex_cli_rs` as their originator.
- Replaced Compact tool output and Code / Notebook details with one Tool details setting: Minimal, Compact or Preview. Expanding a tool reveals its available source, output and diffs in every mode.
- Folded shell rows show nonzero exit codes, including in grouped exploration and background terminal results. A plain search with no matches is shown separately from errors.
- Codex settings clarify what prompt overwrite, cache keepalive and voice refresh change, and which tool naming changes are display-only.
- Codex prompt guidance now directs agents to work through recoverable blockers, continue independent work and act on clear requests rather than offering to act.
- Code and Notebook group each tool's usage and rules. Tools with on-demand usage show the same no-argument discovery call.
- Codex sends harness and tool guidance before `AGENTS.md` instructions and the working directory.
- Background shell completion notices collapse to one line. Expand a notice to see its output.
- Expanded Code cells show identical successful shell output once when the shell trace already displays it.
