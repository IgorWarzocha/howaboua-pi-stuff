# @howaboua/pi-codex-conversion

Adapts Pi's tools and prompt for GPT/Codex models. It keeps Pi's sessions, project context, skills, and UI while presenting the shell, patch, image, and web operations those models expect.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

Requires Node.js 22.19 or newer. Native helpers are bundled. The adapter activates for OpenAI `gpt*` and `codex*` models and restores Pi's previous tools when you switch away.

## Tool modes

### Normal mode

Normal mode exposes Codex-shaped Pi tools:

- `exec_command` — shell execution with resumable sessions and optional PTY support
- `write_stdin` — poll or interact with a running shell session
- `apply_patch` — patch-based file edits
- `view_image` — local image inspection when the model supports image input
- `web_run` — Codex-backed web search when enabled and supported
- `imagegen` — Codex-backed image generation and editing when enabled and supported

There is no separate text `read`, `edit`, or `write` tool. Use `exec_command` for file inspection and `apply_patch` for edits.

### PATH mode

PATH mode exposes only `exec_command` and `write_stdin` as structured adapter tools. `apply_patch`, `view_image`, `web_run`, and `imagegen` become commands on an extension-injected internal `PATH`.

Run them inside `exec_command`:

```bash
view_image '{"path":"/x.png"}'
web_run '{"search_query":[{"q":"..."}],"response_length":"short"}'
imagegen '{"prompt":"..."}'
imagegen '{"action":"edit","prompt":"...","images":["/x.png"]}'
```

Generated images are saved under `.pi/openai-codex-images/` at the workspace root, with the newest image mirrored to `latest.png`.

### GPT-5.6 Code Mode

Code Mode is an opt-in beta for OpenAI Codex Luna, Terra, and Sol. Explicitly configured Responses providers may also use those model IDs or the gpt-5.6 alias. Proxy providers retain raw JavaScript exec calls through a custom Responses stream. Responses Lite is optional for proxies and has a separate Beta setting; built-in Codex models use it automatically. Only `exec` and `wait` reach the provider. `exec` composes nested tools locally:

```js
const status = await tools.exec_command({ cmd: "git status --short" });
text(status);
```

Nested `apply_patch`, `view_image`, `web__run`, `image_gen__imagegen`, `exec_command`, and `write_stdin` calls keep normal Pi rendering without exposing their schemas to the provider. When Code Mode becomes active, Pi starts downloading and verifying the pinned V8 host instead of waiting for the first `exec`. Downloads respect standard proxy environment variables and fail instead of hanging indefinitely.
For configured Responses providers, `web__run` uses the active provider's `/responses` endpoint; the proxy must support the Responses `web_search` tool.

## Code Mode custom tools

Put top-level TOML definitions in `~/.pi/agent/codex-conversion-custom-tools/`, or `$PI_CODING_AGENT_DIR/codex-conversion-custom-tools/`. Each filename becomes a method on `tools`.

Definitions are deferred by default; set `defer_loading = false` to add one to the prompt. Disabled examples for `port_info`, `semantic_grep`, `spawn_agent`, `vent`, and `workflows_create` ship under `examples/custom-tools/`.

## Settings

Open `/codex` for the full settings UI. Settings are saved in `~/.pi/agent/pi-codex-conversion.json`.

Direct routes include `/codex all` (cycle full adapter, extra tools only, and off), `/codex fast`, `/codex compact`, `/codex usage`, `/codex reset`, `/codex low|medium|high`, and `/codex ps` for background shells.

To adapt an additional Codex-compatible provider without enabling all-model scope:

```json
{
  "scope": {
    "additionalProviders": ["my-provider"]
  }
}
```

Native compaction applies to OpenAI Codex and explicitly configured passthrough providers listed in `additionalProviders`; the built-in OpenAI Responses endpoint is supported when added. Additional providers must forward the OpenAI/Codex Responses and compaction contracts, such as a renamed provider or compatible LiteLLM route. Enable compaction and choose protocol `v1` or `v2` in `/codex`; both inherit the active model and reasoning level so the request stays on the current prompt-cache lane. V1 remains the default. V2 uses the active model's ordinary streamed Responses transport and excludes injected context messages. Its Beta setting retains roughly 16k, 32k, or Codex-native 64k tokens of recent real user messages beside the encrypted checkpoint. Retention stops at message boundaries; an oversized newest message is kept whole. V1 and V2 checkpoints share the same opaque Responses input contract and can be compacted by either protocol.

The first compact request sends the full active transcript, and later requests send the previous opaque checkpoint plus its exact live tail. Oversized requests preserve the cached history prefix by only rewriting contiguous trailing tool and tool-search outputs when the transcript exceeds Codex's effective context window. Failed endpoint requests and invalid compaction outputs fall back to Pi's normal compaction. Unsupported preparation or compatibility states cancel compaction and report the error instead of silently discarding context.

Process control, PTYs, patching, images, and large outputs run through bundled Rust helpers, so failures normally become tool errors instead of crashing Pi. PATH image results render inline; recognized `web_run` and `imagegen` calls wait up to one hour before becoming resumable.

## Binary compatibility

If a published binary fails with `GLIBC_* not found`, a loader error, or an `exec_bridge` startup failure, use a checkout and rebuild that helper on the target machine rather than changing system glibc or patching the installed package:

```bash
git clone https://github.com/IgorWarzocha/howaboua-pi-stuff.git
cd howaboua-pi-stuff
bun install
bun run --cwd packages/pi-codex-conversion build:path-tool codex-exec-shim exec_bridge
bun run --cwd packages/pi-codex-conversion build
pi --no-extensions --no-skills -e ./packages/pi-codex-conversion
```

See [`PATH_TOOLS.md`](./PATH_TOOLS.md) for helper details and [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md) for provider and vendored-source parity.

## License

MIT. Bundled and vendored third-party components retain their own licenses and notices.
