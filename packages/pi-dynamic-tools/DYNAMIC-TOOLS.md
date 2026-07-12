# Dynamic tools

Use this reference when asked to add, change, debug, or explain dynamic tools. Do not inspect every existing definition unless the task requires it. Do not enable a bundled example unless the user explicitly asks.

## How it works

A dynamic tool connects one JavaScript method inside Pi's `exec` tool to one local command-line program:

```text
tools.<filename>(input string)
  → TOML command definition
  → local process
  → string result
```

Definitions are top-level `*.toml` files under the Pi agent directory's `dynamic-tools/` folder (`~/.pi/agent/dynamic-tools/` by default, or `$PI_CODING_AGENT_DIR/dynamic-tools/` when configured). Companion scripts may live in subdirectories. Pi rediscovers definitions before every `exec`; already-running cells keep the definitions they started with.

The JavaScript cell is isolated V8 with no direct filesystem, network, or Node access. The delegated command is not sandboxed by code mode: it runs locally with the user's permissions, Pi's working directory, and inherited environment.

## Dynamic tool or Pi extension?

Consider a dynamic tool first when the capability is command-backed, tool-shaped, and useful only occasionally. Deferred tools add no tool-specific system-prompt or provider-schema cost. A stable promoted tool adds only its terse invocation form rather than a full provider-visible JSON schema.

Use a dynamic tool when:

- one string can carry the input directly or as JSON;
- a local process can own validation, dependencies, filesystem or network access, and output formatting;
- the capability should compose with other calls inside `exec`;
- the tool is infrequent enough to stay deferred, or stable enough to promote deliberately.

Build a Pi extension when the capability needs lifecycle events, custom TUI, Pi session state, provider interception, tool-call interception, runtime tool activation, or a directly exposed structured schema. Do not build an extension merely to wrap a command that fits the dynamic-tool boundary.

## Add or change a tool

1. Confirm the command or script that should perform the work. TOML is only the bridge; complex parsing and behavior belong in the CLI.
2. Create the definitions directory if it does not exist. Choose a descriptive JavaScript-compatible filename. Start with a letter, `_`, or `$`; use only letters, numbers, `_`, and `$` after that.
3. Create or update only the relevant TOML and companion files.
4. Keep the tool deferred unless the user explicitly wants it named in every system prompt.
5. Validate the command independently when practical.
6. The changed catalog is available on the next `exec`. Do not send slash commands as agent tool calls.

Minimal definition:

```toml
# repo_snapshot.toml
command = "repo-snapshot"
```

A complex tool still receives one string. Encode structured input as JSON and validate it in the CLI:

```toml
# inspect_repo.toml
description = 'Inspect a repository. Input JSON fields: query (string) and optional cwd (string).'
command = "./inspect-repo/inspect-repo.mjs"
input = "stdin"
```

The model calls it with:

```js
const result = await tools.inspect_repo(JSON.stringify({
  query: "Find the authentication entry points",
  cwd: "../another-repo",
}));
text(result);
```

## TOML fields

`command` is required. These fields are accepted; unknown fields, invalid TOML, and invalid filename identifiers prevent the extension from loading its tool catalog until corrected.

- `command`: executable name or path.
- `args`: fixed string arguments placed before the model-provided input. Defaults to `[]`.
- `input`: `"arg"` appends the input as the final argument; `"stdin"` writes it to standard input. Defaults to `"arg"`.
- `description`: discovery help. State the action and any input contract the caller must know.
- `output`: optional discovery help about a reliable result contract. It does not control, validate, or transform command output. Omit it when the result is free-form.
- `defer_loading`: defaults to `true`. Set to `false` only when the user wants the tool named in the system prompt.

Command resolution:

- Bare names resolve through inherited `PATH`.
- Absolute paths run directly.
- Relative command paths resolve from the directory containing the TOML file.
- Relative entries inside `args` are not rewritten; resolve them inside the CLI or use paths appropriate to Pi's working directory.
- Relative or absolute `.js`, `.mjs`, and `.cjs` commands run with Pi's JavaScript runtime.
- Commands run directly without a shell. Shell expansion, pipes, aliases, and redirection do not apply unless the configured command explicitly launches a shell.

## Deferred and promoted tools

Deferred is the cache-safe default:

```toml
command = "rare-tool"
```

A deferred tool remains callable but its name and help do not enter the system prompt or provider tool schema. Its metadata stays local in `ALL_TOOLS` until requested. The outer `exec` and `wait` tools are always registered, even with an empty catalog, so adding, removing, or editing deferred definitions during a session does not change that stable provider contract.

Inspect only the metadata needed:

```js
text(ALL_TOOLS.find(({ name }) => name === "rare_tool"));
```

Promote a stable, frequently used tool only by explicit choice:

```toml
defer_loading = false
command = "common-tool"
```

Promotion adds a terse `await tools.<name>(input)` form to the system prompt. Changing the promoted set or names changes that prompt and can invalidate its cache. Descriptions and `output` help remain available through `ALL_TOOLS` rather than being copied into the system prompt.

## Execution and failures

Every dynamic method accepts one string and resolves to one string.

- A successful command returns stdout with trailing whitespace removed.
- If stdout is empty, stderr is returned instead.
- If both are empty, the result is `(no output)`.
- A non-zero exit is an error and includes stderr when available.
- Cancellation stops the delegated process; on supported Unix-like systems it kills the process group.
- Combined stdout and stderr are limited to 50 KiB. Exceeding the limit terminates the process and returns an error.

The `exec` cell can compose calls with normal JavaScript, including `Promise.all`, `store`/`load`, progress notifications, images, yielding, and resumable `wait` cells. Read the `exec` tool contract for those runtime details rather than duplicating it here.

## Bundled examples

Examples are documentation and working reference code. Installing the package does not register or enable them. Do not copy an example merely because you read this file.

### `spawn_agent`

The package directory containing this file also contains:

```text
examples/spawn_agent.toml
examples/spawn-agent/
  spawn-agent.mjs
  explorer.prompt.md
  reviewer.prompt.md
```

When the user explicitly asks to enable the example, copy `examples/spawn_agent.toml` into the definitions directory and copy `examples/spawn-agent/` beside it, preserving that layout. The TOML's relative command then resolves to `spawn-agent/spawn-agent.mjs`.

The example demonstrates a deferred tool with JSON input:

```js
const result = await tools.spawn_agent(JSON.stringify({
  agent_type: "explorer",
  message: "Find the authentication entry points and cite the relevant files.",
  cwd: "../another-repo",
}));
text(result);
```

Its contract is:

- `agent_type`: required; `"explorer"` or `"reviewer"`.
- `message`: required standalone instructions.
- `cwd`: optional; defaults to Pi's working directory and resolves relative to it.

`explorer` runs GPT-5.6 Luna with low reasoning and a discovery-only appended system prompt.

`reviewer` runs GPT-5.6 Sol with medium reasoning and the same rubric as the review extension. Before starting Pi, the example resolves the Git repository root and prepares a user message with the current ref, selected local base branch, merge base, working-tree status, appropriate diff commands, and the caller's instructions. The rubric is appended to Pi's normal system prompt; project context remains loaded.

Both roles disable child extensions, skills, and prompt templates. This avoids recursive dynamic tools and machine-specific behavior while retaining project context files and Pi's built-in discovery tools.

### `port_info`

The package also contains:

```text
examples/port_info.toml
examples/port-info/port-info.mjs
```

This example compresses a platform-specific system investigation into one argument:

```js
const result = await tools.port_info("3000");
text(result);
```

It returns normalized JSON containing TCP/UDP listeners, active connections, owning process details, parent-process information, and service or container attribution when available. It reports partial-inspection and permission failures in `diagnostics` instead of hiding them, and caps endpoint results at 25 with bounded process metadata.

- Linux reads `/proc/net` and process metadata directly without requiring `ss` or `lsof`.
- macOS and other Unix-like systems use `lsof` and `ps` when available.
- Windows uses `Get-NetTCPConnection`, `Get-NetUDPEndpoint`, process metadata, and service metadata through PowerShell.

Process command lines and working directories can contain sensitive information. Enable or invoke this example only when that system inspection is appropriate.

When the user explicitly asks to enable it, copy `examples/port_info.toml` into the definitions directory and copy `examples/port-info/` beside it, preserving the layout.
