# Capture native agent sessions

Capture stores the agent's own session identity on its local hc terminal. It does not scan session directories, infer the latest session, or poll processes. Resume commands cover all 18 agents from old Herdr. Automatic capture needs the integration described below.

The adapters do not install themselves. Keep existing hooks when merging these fragments. Commands require Node and `hc` on the agent's machine. Hooks without `HC_TERMINAL_ID` do nothing. A remote viewer does not run the hook on the viewer's machine.

Capture verifies Linux `/proc` ancestry against Core's terminal root before writing. Only the outermost recognised native coding agent may own the terminal. Nested agents cannot replace or clear the parent's identity, even when only legacy Pi labels exist. `herdr.state.owner` records the native agent PID, not the short-lived hook PID. A verified outermost agent can replace stale owners. Other platforms are unsupported by this ownership check. No process polling is involved.

## Pi

Load `integrations/pi.ts` with Pi's `-e` option, or symlink it into Pi's extension directory. Keep the source tree intact because it imports the shared ownership check. It is independent of voice and labels the exact `getSessionFile()` path. Without a session file, as with `--no-session`, it clears its resumable reference and sets `herdr.state.ephemeral=1`, so stale voice or legacy Pi labels cannot be used as a fallback. Shutdown clears that marker. A persistent session clears it when reporting its path.

The installed Pi API emits `session_start` after startup, reload, new session, resume and fork. There are no separate `session_switch` or `session_fork` handlers in this version. `session_shutdown` clears the live labels, including on normal quit. Previously saved snapshots retain their recorded identity.

## Command hooks

Print a configuration merge fragment:

```sh
node /home/igorw/Work/herdr-state/integrations/hooks.mjs claude
```

Replace `claude` with any command-hook agent in the table. Output contains absolute paths to this Node executable and `src/capture.mjs`. It is a fragment, not a replacement for the whole settings file. Kimi output is TOML; the other outputs are JSON. Generated commands target POSIX shells. Windows command quoting and installation are manual.

The installer merges JSON hooks automatically. For Kimi it uses Python 3.11's standard `tomllib` to validate an appended entry without rewriting existing settings. Without that parser, install the printed fragment manually. Shared Codex configuration can register `herdr-state capture codex` through the installed helper on each host. The installer recognises that registration and preserves its symlink.

| Agent | Merge location | Native event |
| --- | --- | --- |
| Claude | `~/.claude/settings.json` | `SessionStart`, startup, resume, clear, compact and fork |
| Codex | `~/.codex/hooks.json` | `SessionStart`; also enable `hooks = true` in the existing `[features]` table in `config.toml` |
| Copilot | `~/.copilot/settings.json` | `SessionStart`, direct `bash` handler |
| Devin | `~/.config/devin/config.json`, or `$XDG_CONFIG_HOME/devin/config.json` | `SessionStart` plus prompt, tool, permission and stop hooks to refresh identity |
| Droid | `~/.factory/settings.json` | `SessionStart` |
| Kimi | `~/.kimi-code/config.toml` | `SessionStart` in a `[[hooks]]` entry; old Herdr required Kimi 0.14.0 or newer |
| MastraCode | `~/.mastracode/hooks.json` | Top-level `SessionStart` handler list |
| Qoder CLI | `~/.qoder/settings.json` | `SessionStart` with matcher `*` |
| Qwen | `~/.qwen/settings.json` | `SessionStart` with matcher `*`, timeout in milliseconds |
| Cursor | `~/.cursor/hooks.json` | `sessionStart`, version 1 |
| Antigravity CLI, `agy` | `~/.gemini/config/hooks.json` | Named `herdr-state` block with flat `PreInvocation` handler |
| Grok | `~/.grok/hooks/herdr-state.json` | Nested `SessionStart` handler |
| Letta | `~/.letta/settings.json` | `SessionStart`, quiet handler, timeout in milliseconds |

Use the agent's configured home if it overrides the default path. These formats and units were checked against old Herdr's official integration implementation at `herdrdev/herdr`, commit `ee5bfb50`. They have not been smoke-tested with each live agent. In particular, Codex hook support is version-dependent. This is not a `notify` integration. The Codex hook ignores child identities when an inherited `CODEX_THREAD_ID` identifies a different parent session.

Letta's `conversation_id: "default"` requires its native `agent_id`. Capture stores `default:<agent_id>` so resume preserves both identities. Missing `agent_id` is rejected rather than resuming an unrelated default conversation.

## Plugin-only agents

These adapters use the native APIs from old Herdr. They capture identity only, with no status heuristics or polling. Tests exercise their transport against a fake `hc`, not a live model. Live compatibility with each agent has not been smoke-tested.

| Agent | Adapter and installation location | Boundary |
| --- | --- | --- |
| OMP | Symlink `omp.ts` into `~/.omp/agent/extensions/`. Captures `getSessionFile()` on `session_start` and `session_switch`, and refreshes changed paths on `agent_start`. Clears on shutdown and marks sessions without a file ephemeral. | Nested shells marked `OMPCODE=1` are ignored. `PI_CONFIG_DIR` changes the `.omp` directory component. `PI_CODING_AGENT_DIR`, when set, overrides the agent directory. Never share Pi's extension directory. |
| Hermes | Symlink the `integrations/hermes/` directory as `~/.hermes/plugins/herdr-state`. Add `herdr-state` to `plugins.enabled` in `~/.hermes/config.yaml`. Native `on_session_start` and `on_session_reset` hooks invoke Node capture with the exact `session_id`. | Requires Python's standard library plus `node` on PATH. Only interactive `cli`, `tui`, `desktop` or `acp` events report. `pre_llm_call` refresh is restricted to `cli`. `HERMES_HOME` overrides `~/.hermes`. |
| OpenCode | Register the absolute `integrations/opencode.mjs` file as a plugin. For local `opencode run` and Mini clients, `chat.message` selects the exact native `sessionID`. Later updates refresh only that selected identity. | Full TUI, shared server, web and attach clients are deliberately unsupported by this adapter. Their backend hooks do not identify the viewing terminal. Old Herdr's TUI adapter reads the native route with a 100 ms polling timer. There is no route-selection subscription in that implementation, so equivalent complete capture would violate this project's no-polling requirement. |
| Kilo | Register the absolute `integrations/kilo.mjs` file as a plugin, or use a wrapper in `~/.config/kilo/plugin/` that re-exports `HerdrStatePlugin` from its absolute file URL. `chat.message` selects the exact native `sessionID`. | Capture begins after a native user-message hook, not on arbitrary background session events. Selection without a user message needs a verified native selection signal. Known child sessions cannot replace the selected session. |

OpenCode's default configuration directory is `$XDG_CONFIG_HOME/opencode`, normally `~/.config/opencode`, with `OPENCODE_CONFIG_DIR` as an override. Kilo uses `$XDG_CONFIG_HOME/kilo`. Keep the adapters in this source tree and register their absolute file URLs, or create re-export wrappers, because they share ownership and capture code. Do not copy a single module into an unrelated plugin directory. Pi and OMP must also retain access to the source tree. Hermes resolves the capture path through its source directory, so install it as a symlink rather than copying it.

Hermes plugin configuration fragment:

```yaml
plugins:
  enabled:
    - herdr-state
```

Preserve any other enabled plugins. OpenCode and Kilo ignore unselected creation or update events. Native deletion of the selected session clears both labels. Hook transport failures are surfaced, rather than silently reporting success.

## Manual bridge and clearing

Any native hook can run the same CLI with JSON stdin:

```sh
printf '%s' '{"session_id":"exact-native-id"}' | node /home/igorw/Work/herdr-state/src/capture.mjs codex
printf '%s' '{"session_path":"/absolute/native/session.jsonl"}' | node /home/igorw/Work/herdr-state/src/capture.mjs pi
node /home/igorw/Work/herdr-state/src/capture.mjs pi --clear
```

Use identity values supplied by the agent, not these example strings. Capture recognises common snake_case and camelCase session, conversation and thread ID fields. Only Pi and OMP accept session file paths. `transcript_path` is deliberately not a session path. Missing or invalid identity reports fail visibly without changing labels.

`--clear` removes both live state labels without reading stdin. Use it when a native session ends or is deleted, so a later save cannot mistake stale labels for an active agent. Previously saved snapshots are unaffected. Successful capture prints nothing, so it does not inject text into agent prompts.
