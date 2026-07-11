# pi-dynamic-tools

Expose small command-line tools to Pi through Codex-style JavaScript code mode. Each tool is a separate TOML file; Pi gives the model one `exec` environment where those tools can be composed with normal JavaScript.

## Install

```bash
pi install npm:@howaboua/pi-dynamic-tools
```

The first startup with at least one definition downloads OpenAI Codex's code-mode host for the current platform and verifies its pinned SHA-256 checksum. Installing the extension alone does not download the host.

## Define a tool

Create `~/.pi/agent/dynamic-tools/summarize.toml`:

```toml
description = "Summarize text."
command = "summary-cli"
input = "stdin"
```

The filename becomes the JavaScript method name, so use letters, numbers, `_`, or `$`. `description` and `output` are optional on-demand help text; `output` documents a reliable contract but does not control the command's result. Tools are deferred by default; set `defer_loading = false` to add a commonly used tool's terse invocation form to the system prompt. Full help remains local until requested through `ALL_TOOLS`.

`input` can be:

- `"arg"` — append the string input as the final command argument; this is the default
- `"stdin"` — write the string input to standard input

Bare command names resolve through `PATH`. Relative command paths resolve from the TOML file's directory.

Run `/reload` or restart Pi after adding, changing, or removing definitions.

The extension adds the resolved bundled `DYNAMIC-TOOLS.md` path to the system prompt. Agents read that file only when asked to configure or explain dynamic tools.

For command-backed capabilities, dynamic tools are the lightweight default: keep occasional tools deferred and promote stable frequent ones. Use a full Pi extension when the capability needs lifecycle hooks, UI, session state, provider integration, or a directly exposed structured schema.

## Bundled examples

`examples/spawn_agent.toml` and `examples/spawn-agent/` demonstrate a deferred, dual-role subagent without enabling it. The example accepts JSON containing a required `agent_type` (`explorer` or `reviewer`), required `message`, and optional `cwd`. Explorer uses GPT-5.6 Luna at low reasoning. Reviewer uses GPT-5.6 Sol at medium reasoning and prepares Git base, merge-base, status, and diff context before starting Pi. See `DYNAMIC-TOOLS.md` for the invocation and opt-in copy step.

`examples/port_info.toml` and `examples/port-info/` demonstrate a one-argument system integration without enabling it. The example turns a port number into normalized listener, connection, process, service, and container diagnostics across Linux, macOS, and Windows.

## Model-facing shape

Tools are discovered on demand without changing the stable `exec` schema:

```js
text(ALL_TOOLS.map(({ name }) => name));
text(ALL_TOOLS.find(({ name }) => name === "summarize"));
```

With the definition above, `exec` exposes:

```js
const result = await tools.summarize("Long text to summarize...");
text(result);
```

Multiple tools can be composed without returning intermediate output to the model:

```js
const [auth, config] = await Promise.all([
  tools.summarize("Long authentication report..."),
  tools.summarize("Long configuration report..."),
]);
text({ auth, config });
```

The runtime is OpenAI Codex's isolated V8 code-mode host. It provides `text`, `image`, `store`, `load`, `notify`, `yield_control`, timers, resumable cells, and the companion `wait` tool. It does not expose Node, filesystem, network, or console APIs to JavaScript.

## Source boundary

The Pi extension, TOML loader, command runner, and host client are MIT licensed. Vendored OpenAI Codex sources and downloaded code-mode host binaries are Apache-2.0; see `THIRD_PARTY_LICENSES.md` and `UPSTREAM_SYNC.md`.
