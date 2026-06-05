# pi-codex-conversion

Codex code-mode tools for [Pi](https://github.com/badlogic/pi-mono).

> [!NOTE]
> Use the npm package for normal installs. Avoid `pi install git:...` unless you know you want the development checkout; see [Development checkout](#development-checkout).

GPT/Codex models are strongest when the tool surface looks like the Codex CLI they were trained around: shell commands, resumable terminal sessions, PATH tools, and patch-based edits. This extension brings that workflow to Pi while keeping Pi's runtime, sessions, project context, skills, and UI.

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

## Active tools in adapter mode

When the adapter is active, the LLM sees these Pi tools:

- `exec_command` — shell execution with Codex-style `cmd` parameters and resumable sessions
- `write_stdin` — continue or poll a running exec session

The extension also puts Codex-style tools on `PATH`:

- `apply_patch` — patch edits
- `view_image` — inspect local images
- `web.run` — Codex-backed web search
- `image_gen.imagegen` — Codex-backed image generation and image edits

Notably:

- there is **no** dedicated `read`, `edit`, or `write` tool in adapter mode
- local text-file inspection should happen through `exec_command`
- file creation and edits should default to shell `apply_patch`
- image/web tools run through `exec_command` as PATH tools, not Pi function tools
- Pi may still expose additional runtime tools such as `parallel`; the prompt is written to tolerate that

## PATH tool examples

```bash
view_image '{"path":"/x.png"}'
web.run '{"search_query":[{"q":"..."}]}'
image_gen.imagegen '{"prompt":"..."}'
image_gen.imagegen '{"action":"edit","prompt":"...","images":["https://... or /x.png"]}'
```

For quote-heavy JSON, pass JSON through stdin:

```bash
image_gen.imagegen <<'JSON'
{"prompt":"keep the creature's original style"}
JSON
```

Generated images are saved under `.pi/openai-codex-images/` at the workspace/repo root, with the latest image mirrored to `latest.png`.

## Settings

Use `/codex` to change adapter settings.

- `/codex all` — use the Codex tool and prompt adapter on every model
- `/codex status` — toggle the footer/statusline entry
- `/codex fast` — toggle priority service tier for the OpenAI Codex provider
- `/codex compact` — open native compaction settings
- `/codex usage` — show Codex subscription usage windows for the active OpenAI Codex model
- `/codex low`, `/codex medium`, `/codex high` — set Responses API verbosity
- `/codex ps` — show the background shell widget

Settings are saved globally in `~/.pi/agent/pi-codex-conversion.json`.

The settings UI has **General**, **Compaction**, **Usage**, **Overrides**, and **About** tabs. **Usage** refreshes automatically when opened and can be refreshed manually with `r`. The General tab can force cached WebSockets for the extension-owned OpenAI Codex provider without changing Pi's global transport setting, so other providers keep using the user's normal Pi transport preference.

Advanced users with custom Codex-compatible providers can opt specific providers into the adapter from the **Overrides** tab, or by editing `~/.pi/agent/pi-codex-conversion.json`:

```json
{
  "useAdapterProviders": true,
  "adapterProviders": ["my-provider"]
}
```

The **Compaction** tab can enable native OpenAI Responses compaction and choose the compaction model/reasoning. If native compaction fails, the extension falls back to Pi's normal compaction flow; when an older native compacted window exists, it is included in that Pi fallback summarization request so OpenAI can still use the prior opaque context server-side.

For OpenAI Codex subscription models, the extension adjusts Pi's registered model context windows so Pi's fixed reserve-token compaction heuristic trips at roughly Codex's native auto-compact budget: 90% of Pi's resolved model window. This is calculated from Pi's current model metadata instead of hardcoded per-model limits.

The footer shows the active state, for example:

```text
Codex adapter V: low • fast
```

## What changes in Pi

- Adapter mode activates automatically for OpenAI `gpt*` and `codex*` models, then restores the previous tool set when you switch away.
- Pi's composed prompt is preserved; the extension only adds a small Codex-style tool-use nudge.
- Shell activity is rendered with Codex-like labels such as `Ran`, `Explored`, `Read`, and background-terminal status.
- PATH image outputs from `view_image` and `image_gen.imagegen` render inline in chat.
- Raw command output is still available by expanding the tool result.

## Command rendering examples

- `rg -n foo src` -> `Explored / Search foo in src`
- `rg --files src | head -n 50` -> `Explored / List src`
- `cat README.md` -> `Explored / Read README.md`
- `npm test` -> `Ran npm test`
- `write_stdin({ session_id, chars: "" })` -> `Waited for background terminal`
- `write_stdin({ session_id, chars: "y\n" })` -> `Interacted with background terminal`

## Details worth knowing

- `exec_command` and `write_stdin` use a PTY-backed session manager for interactive commands and long-running processes.
- The package prepends its `bin` directory to `PATH` so bundled Codex tools are available in shell commands.
- `image_gen.imagegen` waits up to five minutes in a foreground `exec_command` call before falling back to a resumable session.
- The package includes bundled binaries and vendored Rust source for the PATH tools.

## Development checkout

The Git checkout is mostly for development and mirrors the maintainer workflow. If you run it directly, you may need to build bundled PATH-tool binaries for your platform.

Run the current checkout without installing globally:

```bash
pi --no-extensions --no-skills -e /path/to/pi-codex-conversion
```

## License

MIT
