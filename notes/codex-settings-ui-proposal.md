# Codex settings UI proposal

## Tab order

`General / Tools / OpenAI / Usage / About`

---

## General

Purpose: choose the adapter mode and where that mode is active.

### Items

- Mode: `Normal` / `Path mode`
- Use for all providers/models: on/off
- Additional providers: comma-separated provider ids
- Statusline: on/off
- Background shells widget: on/off
- Responses compaction: on/off

### Mode meaning

- `Normal`: existing adapter behavior. The extension replaces the default Pi tool/prompt surface with the current Codex-style toolkit and system prompt behavior. `apply_patch` remains available on PATH.
- `Path mode`: the adapter still uses `exec_command` / `write_stdin` as Pi tools, but supported extra tools are surfaced through shell/PATH commands.

### Scope meaning

- GPT/Codex models are the default adapter scope.
- `Use for all providers/models` expands the selected mode to every provider/model.
- `Additional providers` extends the default GPT/Codex scope with user-listed provider ids.
- Additional providers are additive, not a separate “selected providers only” mode.

### Implementation mapping

- Default GPT/Codex scope -> existing model/provider detection.
- `Use for all providers/models` -> existing `useOnAllModels`.
- `Additional providers` -> existing `adapterProviders` plus `useAdapterProviders` when the list is active/non-empty.
- `Mode` needs a new config field, probably `mode: "normal" | "path"`.

---

## Tools

Purpose: show required adapter tools and control optional tool features for the active adapter scope.

### Items

- Shell commands: required
  - `exec_command` + `write_stdin`.
  - Required for the adapter to work.
  - Replaces Pi’s `bash` tool when the adapter is active.
- Apply patch: required in adapter mode / optional for standard GPT toolkit
  - `apply_patch` is PATH-based and should be advertised in the system prompt when active.
  - In adapter mode, this is required.
  - Outside adapter mode, this setting can add apply-patch behavior to GPT models on top of Pi’s standard toolkit.
- View image: required
  - Required when the adapter is active because Pi’s `read` tool is disabled.
- Web search: on/off
  - Controls `web.run` availability/advertising.
  - Applies to GPT/Codex models, additional providers, and all providers/models when enabled.
- Image generation: on/off
  - Controls `image_gen.imagegen` availability/advertising.
  - Applies to GPT/Codex models, additional providers, and all providers/models when enabled.

### Mode behavior

- In `Normal` mode, the adapter works like the current extension: full Codex-style toolkit and system prompt replacement, with `apply_patch` on PATH.
- In `Path mode`, supported extra tools are exposed as PATH commands:
  - `apply_patch`
  - `view_image`
  - `web.run`
  - `image_gen.imagegen`
- `exec_command` and `write_stdin` remain Pi tools in both modes.
- PATH binaries can stay on PATH even when optional tools are toggled off; toggles control adapter activation and system-prompt advertising, not physical binary availability.

---

## OpenAI

Purpose: OpenAI/Codex provider behavior.

### Items

- Fast mode: on/off
- Verbosity: low/medium/high
- Cached websocket upgrade: on/off
- Compaction model
- Compaction reasoning

### Notes

- The compaction on/off toggle lives in General.
- The compaction model/reasoning stay here as OpenAI-specific tuning.
- Default compaction model should be `gpt-5.4-mini`.
- Keep the current compaction warning/notes near the compaction settings.
- This tab is provider-specific; it should not be mixed with adapter mode/scope settings.

---

## Usage

Purpose: Codex subscription usage windows.

### Items

- Usage table
- Refresh with `r`

### Notes

Keep current behavior.

---

## About

Purpose: links and package info.

### Items

- GitHub
- Changelog
- Discord
- Issue form

### Notes

Keep current behavior.

---

# Labels

## Path mode

Adapter mode where supported tools are surfaced through shell/PATH commands.

Avoid:

- Code mode
- Codex proxy

## Use for all providers/models

Expands the selected adapter mode beyond GPT/Codex models to every provider/model.

Avoid:

- Use on all models as a top-level mode
- Apply to: Selected providers
- Overrides

## Additional providers

Provider ids that should also receive the selected adapter mode, in addition to GPT/Codex models.

Avoid:

- Proxy providers
- Adapter providers
- Selected providers

---

# Config migration

This version should rejig the config shape instead of preserving the old flat shape forever.

On read:

1. Read `~/.pi/agent/pi-codex-conversion.json`.
2. Detect old-shape config.
3. Convert it to the new shape once.
4. Write the new-shape config back.
5. Use only the new shape internally after that.

Keep the migration in a separate file so it can be deleted easily later:

`packages/pi-codex-conversion/src/adapter/config-migration.ts`

## New config shape

```json
{
  "mode": "normal",
  "scope": {
    "allProviders": false,
    "additionalProviders": []
  },
  "tools": {
    "webRun": true,
    "imageGeneration": true,
    "applyPatchForStandardGpt": false
  },
  "ui": {
    "statusLine": true,
    "backgroundShellWidget": true,
    "backgroundShellToggleShortcut": "alt+w",
    "backgroundShellPrevShortcut": "alt+q",
    "backgroundShellNextShortcut": "alt+e",
    "backgroundShellCloseShortcut": "alt+r"
  },
  "compaction": {
    "responsesCompaction": false
  },
  "openai": {
    "fast": false,
    "verbosity": "low",
    "forceCachedWebSockets": true,
    "compactionModel": "gpt-5.4-mini",
    "compactionReasoning": "current"
  }
}
```

## Old to new mapping

- `useOnAllModels` -> `scope.allProviders`
- `adapterProviders` -> `scope.additionalProviders`
- Preserve `adapterProviders` during migration even when old `useAdapterProviders=false`
- `statusLine` -> `ui.statusLine`
- `backgroundShellWidget` -> `ui.backgroundShellWidget`
- `backgroundShellToggleShortcut` -> `ui.backgroundShellToggleShortcut`
- `backgroundShellPrevShortcut` -> `ui.backgroundShellPrevShortcut`
- `backgroundShellNextShortcut` -> `ui.backgroundShellNextShortcut`
- `backgroundShellCloseShortcut` -> `ui.backgroundShellCloseShortcut`
- `fast` -> `openai.fast`
- `verbosity` -> `openai.verbosity`
- `forceCachedWebSockets` -> `openai.forceCachedWebSockets`
- `responsesCompaction` -> `compaction.responsesCompaction`
- `compactionModel` -> `openai.compactionModel`, defaulting to `gpt-5.4-mini` when absent/invalid
- `compactionReasoning` -> `openai.compactionReasoning`

## New defaults

- `mode`: `normal`, including for migrated users
- `tools.webRun`: `true`
- `tools.imageGeneration`: `true`
- `tools.applyPatchForStandardGpt`: `false`
- `openai.compactionModel`: `gpt-5.4-mini`

## Not configurable

These are required adapter behavior and should not be stored as toggles:

- Shell commands: `exec_command` + `write_stdin`
- View image in adapter mode
- Apply patch in adapter mode

The `tools` object should only store actual user choices.
