# @howaboua/pi-dynamic-tools

Exposes command-line programs to Pi through Codex-style JavaScript Code Mode. Tools are small TOML definitions; the model composes them inside one isolated `exec` environment.

## Install

```bash
pi install npm:@howaboua/pi-dynamic-tools
```

Definitions live in `~/.pi/agent/dynamic-tools/`, or `$PI_CODING_AGENT_DIR/dynamic-tools/` when that variable is set. Installing the package does not enable the bundled examples.

The first `exec` with at least one definition downloads the pinned OpenAI Codex Code Mode host for the current platform and verifies its SHA-256 checksum. No host is downloaded while the definitions directory is empty.

## Define a tool

Create one top-level TOML file per tool. Its filename becomes the method on `tools`, so use letters, numbers, `_`, or `$`.

```toml
usage = '''await tools.spawn_agent(JSON.stringify({ agent_type: "explorer" | "reviewer", message: string, cwd?: string }))'''
description = "Relative cwd resolves from Pi's working directory."
command = "./spawn-agent/spawn-agent.mjs"
input = "stdin"
```

- `usage` is required and shows the exact JavaScript call.
- `command` may be on `PATH` or relative to the TOML file.
- `input` is `"arg"` (default) or `"stdin"`.
- `description` and `output` are optional on-demand help.
- Set `defer_loading = false` to put a frequent tool in the prompt.

Definitions are rediscovered before each `exec`, so additions and edits take effect during the session. Deferred help stays local until the model looks up the tool through `ALL_TOOLS`.

Use dynamic tools for command-backed capabilities. Use a full Pi extension when the capability needs lifecycle hooks, UI, session state, provider integration, or a provider-visible schema.

Disabled examples cover `spawn_agent`, `port_info`, `semantic_grep`, `vent`, and `workflows_create`. See [`DYNAMIC-TOOLS.md`](./DYNAMIC-TOOLS.md) for setup and troubleshooting.

## Runtime boundary

`exec` runs in OpenAI Codex's isolated V8 host with output, state, timer, and resumable-cell helpers. It does not expose Node.js, filesystem, network, or console APIs directly.

The Pi integration is MIT-licensed. Vendored Codex source and downloaded host binaries are Apache-2.0; see [`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md) and [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md).
