# pi-codex-conversion

Codex-style tools for [Pi](https://github.com/badlogic/pi-mono).

> [!NOTE]
> Use the npm package for normal installs. Avoid `pi install git:...` unless you know you want the development checkout; see [Development checkout](#development-checkout).

GPT/Codex models are strongest when the tool surface looks like the Codex CLI they were trained around: shell commands, resumable terminal sessions, and patch-based edits. This extension brings that workflow to Pi while keeping Pi's runtime, sessions, project context, skills, and UI.

The point is to give the model tools it already knows how to use well: shell-first inspection, resumable command sessions, and large one-shot patch edits instead of piecemeal read/edit/write steps.

You can also opt into using the adapter on every provider/model. YMMV: Codex-tuned models are still the best fit, but the shell/patch workflow can help elsewhere too. The extension also has a small `/codex` settings UI for toggling adapter behavior, web search, image generation, fast mode, native Responses compaction, and verbosity. See [Settings](#settings).

## Install

```bash
pi install npm:@howaboua/pi-codex-conversion
```

![Available tools](./available-tools.png)

## Active tools in adapter mode

When the adapter is active, the LLM sees these tools:

- `exec_command` — shell execution with Codex-style `cmd` parameters and resumable sessions
- `write_stdin` — continue or poll a running exec session
- `apply_patch` — patch tool
- `web.run` — native OpenAI Codex Responses web search, enabled only on the `openai-codex` provider
- `image_generation` — native OpenAI Codex Responses image generation, enabled only on image-capable `openai-codex` models
- `view_image` — image-only wrapper around Pi's native image reading, enabled only for image-capable models

Notably:

- there is **no** dedicated `read`, `edit`, or `write` tool in adapter mode
- local text-file inspection should happen through `exec_command`
- file creation and edits should default to `apply_patch`
- Pi may still expose additional runtime tools such as `parallel`; the prompt is written to tolerate that instead of assuming a fixed four-tool universe

## Settings

Use `/codex` to change adapter settings.

- `/codex all` — use the Codex tool and prompt adapter on every model
- `/codex status` — toggle the footer/statusline entry
- `/codex fast` — toggle priority service tier for the OpenAI Codex provider
- `/codex search` — toggle native Codex web search
- `/codex image` — toggle native Codex image generation
- `/codex usage` — show Codex subscription usage windows for the active OpenAI Codex model
- `/codex low`, `/codex medium`, `/codex high` — set Responses API verbosity

Settings are saved globally in `~/.pi/agent/pi-codex-conversion.json`.

The settings UI also has **Usage**, **Overrides**, and **About** tabs. **Usage** refreshes automatically when opened and can be refreshed manually with `r`. The General tab can force cached WebSockets for the extension-owned OpenAI Codex provider without changing Pi's global transport setting, so other providers keep using the user's normal Pi transport preference. Override options intentionally do not have `/codex ...` command shortcuts:

- add only the Pi `apply_patch` tool for GPT/Codex models while keeping Pi's default toolkit, prompt, provider behavior, and compaction flow

Advanced users with custom Codex-compatible providers can opt specific providers into the adapter from the **Overrides** tab, or by editing `~/.pi/agent/pi-codex-conversion.json`:

```json
{
  "useAdapterProviders": true,
  "adapterProviders": ["my-provider"]
}
```

This only enables the Codex tool/prompt adapter for those provider ids. Native Codex web search, native image generation, and priority service tier remain limited to the built-in `openai-codex` provider.

The **Compaction** tab can enable native OpenAI Responses compaction and choose the compaction model/reasoning. If native compaction fails, the extension falls back to Pi's normal compaction flow; when an older native compacted window exists, it is included in that Pi fallback summarization request so OpenAI can still use the prior opaque context server-side.

For OpenAI Codex subscription models, the extension also adjusts Pi's registered model context windows so Pi's fixed reserve-token compaction heuristic trips at roughly Codex's native auto-compact budget: 90% of Pi's resolved model window. This is calculated from Pi's current model metadata instead of hardcoded per-model limits.

When `all` is on, or when a provider is listed in `adapterProviders`, non-Codex providers get the shell, patch, skill, and prompt-adapter behavior, but keep their normal Pi provider path. Native web search, native image generation, and priority service tier stay limited to the OpenAI Codex provider. Verbosity is applied to Responses API providers.

The footer shows the active state, for example:

```text
Codex adapter V: low • web search • image gen
```

## What changes in Pi

- Adapter mode activates automatically for OpenAI `gpt*` and `codex*` models, then restores the previous tool set when you switch away.
- Pi's composed prompt is preserved; the extension only adds a small Codex-style tool-use nudge.
- Shell activity is rendered with Codex-like labels such as `Ran`, `Explored`, `Read`, and background-terminal status.
- `apply_patch` renders as Codex-style `Added` / `Edited` / `Deleted` blocks, including inline partial-failure state.
- Native web search appears as a compact expandable summary after a turn, with queries and sources in the expanded view.
- Generated images are saved under `.pi/openai-codex-images/` at the workspace/repo root, with the latest image mirrored to `latest.png`.

## Command rendering examples

- `rg -n foo src` -> `Explored / Search foo in src`
- `rg --files src | head -n 50` -> `Explored / List src`
- `cat README.md` -> `Explored / Read README.md`
- `npm test` -> `Ran npm test`
- `write_stdin({ session_id, chars: "" })` -> `Waited for background terminal`
- `write_stdin({ session_id, chars: "y\n" })` -> `Interacted with background terminal`

Raw command output is still available by expanding the tool result.

## Details worth knowing

- `exec_command` and `write_stdin` use a PTY-backed session manager for interactive commands and long-running processes.
- `apply_patch` accepts absolute paths as-is and resolves relative paths against the current working directory.
- Shell `apply_patch` is also available inside `exec_command`, but the dedicated `apply_patch` tool is preferred unless you are chaining edits with other shell steps.
- Native `web.run` and `image_generation` are forwarded to OpenAI Codex Responses tools rather than executed as local function tools.

## Development checkout

The Git checkout is mostly for development and mirrors the maintainer workflow. If you run it directly, you may need to build the bundled `apply_patch` binary for your platform.

Run the current checkout without installing globally:

```bash
pi --no-extensions --no-skills -e /path/to/pi-codex-conversion
```

## License

MIT
