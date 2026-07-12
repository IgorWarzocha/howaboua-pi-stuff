# Code Mode dynamic tools

Use this reference when asked to add, change, debug, or explain dynamic tools used by GPT-5.6 Code Mode.

## Definitions

Definitions are top-level `*.toml` files under `~/.pi/agent/dynamic-tools/`, or `$PI_CODING_AGENT_DIR/dynamic-tools/` when configured. Each filename becomes a JavaScript method on `tools`, so use a JavaScript-compatible identifier.

```toml
usage = 'await tools.port_info(port_number)'
description = "Returns listener and owning-process information."
output = "Normalized JSON."
command = "./port-info/port-info.mjs"
input = "arg"
defer_loading = true
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

Unknown fields and invalid definitions fail explicitly. Bare commands resolve through `PATH`; relative commands resolve from the TOML directory. JavaScript commands run with Pi's JavaScript runtime. Commands run directly without shell expansion.

## Deferred tools

Deferred tools remain callable but add nothing tool-specific to the provider schema or system prompt. Their metadata is available through `ALL_TOOLS`:

```js
text(ALL_TOOLS.map(({ name }) => name));
text(ALL_TOOLS.find(({ name }) => name === "port_info"));
```

Set `defer_loading = false` only for stable, frequently used tools. Promotion adds only the name and `usage` to the system prompt; full help remains local.

## Execution

Every TOML tool accepts one string and resolves to one string. Use `JSON.stringify(...)` when a command expects structured input. Commands inherit Pi's working directory, environment, permissions, and cancellation signal; the V8 JavaScript cell itself has no Node, filesystem, network, or console access.

Successful commands return trimmed stdout, then stderr when stdout is empty, then `(no output)`. Non-zero exits include stderr. Combined output is capped at 50 KiB, and cancellation terminates the delegated process group where supported.

Prefer a dynamic tool over another Pi extension for occasional command-backed capabilities. Use an extension when the capability needs lifecycle events, custom UI, Pi session state, provider interception, or a directly exposed provider schema.
