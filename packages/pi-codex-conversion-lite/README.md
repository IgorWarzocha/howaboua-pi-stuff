# @howaboua/pi-codex-conversion-lite

Codex-oriented tools, transport, compaction, and voice for Pi. Lite keeps one structured-tool experience for ordinary Responses models and adds Code Mode where GPT-5.6 supports Responses Lite.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion-lite
```

Requires Node.js 22.19 or newer. The package includes native helpers for supported Linux, macOS, and Windows targets.

## Runtime modes

### Structured tools

The default route uses standard Responses and flat JSON-schema tools:

- `exec_command` and `write_stdin` for shell sessions
- `apply_patch` for file edits
- `view_image` when image input or the text-model fallback is available
- `web_run` and `imagegen` when enabled and supported

This route covers pre-5.6 models and GPT-5.6 models without Code Mode. There is no public PATH mode or injected command wrapper.

### GPT-5.6 Code Mode

Code Mode is opt-in under `/codex adapter`. OpenAI Codex Luna, Terra, and Sol use Responses Lite; explicitly configured `openai-responses` providers may also use the `gpt-5.6` alias after `Proxy Responses Lite` is enabled.

Only `exec` and `wait` reach the model. JavaScript passed to `exec` composes nested `exec_command`, `write_stdin`, `apply_patch`, `view_image`, `web__run`, `image_gen__imagegen`, and configured custom tools locally. Responses Lite serializes provider tool calls because the backend does not accept parallel tool calls under Lite; nested calls may still be composed with `Promise.all`.

Top-level TOML custom tools live in `~/.pi/agent/codex-conversion-custom-tools/` and trusted project tools in `<session-cwd>/.pi/codex-conversion-custom-tools/`. See [`src/tools/code-mode/CUSTOM-TOOLS.md`](src/tools/code-mode/CUSTOM-TOOLS.md).

## Settings and compatibility

Open `/codex` or route directly to a tab such as `/codex openai`. Lite deliberately reads and writes the original package's file:

```text
~/.pi/agent/pi-codex-conversion.json
```

Existing grouped and legacy fields are tolerated. A saved `mode: "path"` is treated as the normal structured-tool route, so replacing `pi-codex-conversion` requires no config reset.

Use `scope.additionalProviders` for an explicit compatible proxy:

```json
{
  "scope": { "additionalProviders": ["my-provider"] }
}
```

Responses compaction uses V2 through the registered raw-item-aware Responses stream. It remains limited to OpenAI Codex and explicitly configured OpenAI/Codex-compatible passthrough providers.

## Voice

Native Codex voice is retained. `/codex voice realtime` starts delegated V3 conversation; `/codex voice dictation` uses V2 transcription and inserts the finalized text into Pi. `Ctrl+Alt+Space` toggles conversation and `Ctrl+Alt+D` is push-to-dictate by default.

Microphone and speaker IO stay in the bundled helper. Pi owns authentication and agent execution. Routed voice requests enter Pi through the same turn pipeline as typed input, preserving its active tools and per-turn prompt setup. Optional device IDs and shortcuts are stored under `voice` in the shared config. `Voice features only` leaves model tools, prompts, requests, compaction, and adapter widgets untouched.

For a Pi session running on another machine, run `/codex voice server` to toggle the LAN server directly, or open `/codex voice` and use **LAN voice server** in settings. Pi serves the GipPity remote control directly on the machine's LAN and Tailscale addresses; open one of the displayed URLs and accept the local certificate on first visit. The page converts the current Pi theme's semantic colors for the browser and shows Pi's working state and latest settled response. **Voice** uses the browser's configured microphone and speaker while Pi keeps Codex login, the continuous Realtime conversation, and agent work on the host. **Dictate** transcribes into an editable web draft that can be sent through Pi's normal user-message path. The draft can be sent while either audio mode remains active, including steering work already running in Pi. Tapping another device transfers audio there and releases the previous microphone without restarting the conversation; the draft follows the server session. LAN voice has no authentication and is intended for trusted networks. It stops when disabled, when its owning Pi session changes, or when Pi shuts down.

## Native helper compatibility

If a bundled helper cannot load on the target system, build it from a checkout and load that checkout instead of patching an installed npm package:

```bash
git clone https://github.com/IgorWarzocha/howaboua-pi-stuff.git
cd howaboua-pi-stuff
bun install
bun run --cwd packages/pi-codex-conversion-lite build:native-tool codex-exec-shim exec_bridge
bun run --cwd packages/pi-codex-conversion-lite build
pi --no-extensions --no-skills -e ./packages/pi-codex-conversion-lite
```

Provider and vendored-source parity notes live in [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md).

## License

MIT. Bundled and vendored third-party components retain their licenses and notices.
