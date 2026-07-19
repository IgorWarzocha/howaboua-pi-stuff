# Code Mode custom tools

Use this reference when asked to add, change, debug, or explain custom tools used by GPT-5.6 Code Mode. Do not enable bundled examples unless the user asks.

## Definitions

Definitions are top-level `*.toml` files in either location:

- global: `~/.pi/agent/codex-conversion-custom-tools/`, or `$PI_CODING_AGENT_DIR/codex-conversion-custom-tools/` when configured
- project-local in trusted projects: `<launch-directory>/.pi/codex-conversion-custom-tools/`

Only the directory where Pi was launched is checked; parent directories are not searched. Project-local definitions are ignored unless Pi trusts the project. A project-local definition replaces a global definition with the same tool name. Each filename becomes a JavaScript method on `tools`, so use a JavaScript-compatible identifier.

```toml
usage = 'await tools.port_info(port_number)'
description = "Returns listener and owning-process information."
output = "Normalized JSON."
command = "./port-info/port-info.mjs"
input = "arg"
defer_loading = true
yield_time_ms = 30000
```

Required fields:

- `usage`: exact JavaScript invocation contract.
- `command`: executable name or path.

Optional fields:

- `description`: discovery detail not clear from the name and usage.
- `output`: reliable result contract; documentation only.
- `args`: fixed string arguments before model input.
- `input`: `"arg"` (default) or `"stdin"`.
- `defer_loading`: defaults to `true`.
- `yield_time_ms`: non-negative integer controlling how long `exec` initially waits when the source directly invokes this tool. It overrides the `// @exec` value and is not exposed as a model-facing argument. If one cell directly invokes several configured tools, the largest value wins.

Unknown fields and invalid definitions disable only that named tool. The tool remains visible in `exec` and throws its configuration error when called, while valid custom tools and built-in Code Mode tools remain available. An invalid project-local definition still suppresses a same-named global definition rather than silently changing behavior. Invalid JavaScript identifiers and unreadable tool directories, which cannot be represented as named tools, are reported through Pi. Bare commands resolve through `PATH`; relative commands resolve from the TOML directory. JavaScript commands run with Pi's JavaScript runtime. Commands run directly without shell expansion.

## Deferred tools

Deferred tools remain callable but add nothing tool-specific to the provider schema or system prompt. Their metadata is available through `ALL_TOOLS`:

```js
text(ALL_TOOLS.map(({ name }) => name));
text(ALL_TOOLS.find(({ name }) => name === "port_info"));
```

Set `defer_loading = false` only for stable, frequently used tools. Promotion adds only `usage` to the system prompt; full help remains local.

## Bundled examples

Working, disabled templates ship under the package root's `examples/custom-tools/` directory:

- `herdr_agent`: finds and coordinates Pi agents in Herdr panels; use with `more_skills` for advanced Herdr orchestration.
- `more_skills`: lists or loads additional skills from the corresponding global or project-local `more-skills/` directory.
- `port_info`: cross-platform listener and process diagnostics.
- `semantic_grep`: queries an existing index owned by an installed and configured `@howaboua/pi-semantic-grep`.
- `sites` and `sites_documentation`: a curated, private-API bridge to the ChatGPT Sites beta using Pi's OpenAI Codex OAuth; keep both definitions together.
- `spawn_agent`: launches isolated explorer or reviewer Pi processes.
- `vent`: appends batched workflow-friction notes to `VENT.md`.
- `workflows_create`: creates or updates repo-local workflow skills.

To enable one, copy its top-level TOML and matching companion directory into `codex-conversion-custom-tools/`, preserving their relative layout. Examples are references, not defaults; never copy or enable one merely because it exists.

## Execution

Every custom tool accepts one string and resolves to one string. Use `JSON.stringify(...)` when a command expects structured input. Commands inherit Pi's working directory, environment, permissions, and cancellation signal; the V8 JavaScript cell itself has no Node, filesystem, network, or console access.

Successful commands return trimmed stdout, then stderr when stdout is empty, then `(no output)`. Non-zero exits include stderr. Combined output is capped at 50 KiB, and cancellation terminates the delegated process group where supported.

Prefer a custom tool over another Pi extension for occasional command-backed capabilities. Use an extension when the capability needs lifecycle events, custom UI, Pi session state, provider interception, or a directly exposed provider schema.
