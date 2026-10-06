# Pi Codex Guardian

Review pending agent actions with Codex Guardian before Pi executes them. The default policy reviews command and code execution, file changes, and other tools, including external actions and unfamiliar tools. Known read-only tools skip review. The same policy applies to ordinary and nested calls, including Code Mode and Notebook Mode wrapper source, `exec_command`, and `write_stdin`.

Guardian turns on when installed. Reviews require Pi 1.0.4 or later, ChatGPT OAuth sign-in, and a current parent response using the Codex Responses API at the canonical ChatGPT endpoint. Actions requiring review are blocked on other models or unverified parent responses. Actions outside the configured review scope do not require a Codex parent. Code Mode and Notebook Mode additionally require Pi Codex Conversion 3.0.46 or later.

## Install

```sh
pi install npm:@howaboua/pi-codex-guardian
```

Start a new Pi session with a signed-in Codex model. Guardian sends the selected parent instructions, transcript, tool declarations, and exact pending action to `codex-auto-review`. Installing alongside Conversion uses its currently registered provider automatically. Native Pi works without Conversion.

Parent credit requests require the native ChatGPT subscription backend, stored subscription credentials, and canonical model and provider endpoints. Configured API-key handlers, runtime keys, custom authentication and legacy stream overrides do not qualify. Guardian reviewer requests never request parent credits. These checks follow the client-side eligibility contract; the backend's billing decision is not observable here.

## Control

```text
/guardian status
/guardian on
/guardian off
/guardian reload
```

The setting persists in the selected session branch. New sessions default to on. `/guardian` without arguments shows status. Only the user command changes the setting. Guardian adds no agent tool or standing prompt.

Status shows whether nested preflight is available and the last completed verdict. Review token counts are not charges. Guardian billing eligibility and per-review cost have not been established, so this package makes no zero-cost claim.

## Review scope

No configuration is required. To adjust the defaults, use either file:

- Global: `~/.pi/agent/pi-codex-guardian.json`, respecting `PI_CODING_AGENT_DIR`.
- Repo: `.pi/pi-codex-guardian.json` in the Pi session's working directory. Parent directories are not searched. Pi must trust the folder.

```json
{
  "review": {
    "execution": true,
    "fileChanges": true,
    "readOnly": false,
    "otherTools": true
  }
}
```

These are the shipped defaults. Each supplied repo setting overrides its global counterpart. Omitted settings inherit. `true` requests review; `false` skips review, not execution.

| Scope | Tools |
|---|---|
| `execution` | `bash`, `powershell`, `exec_command`, `write_stdin`, `exec`, `wait`, `notebook` |
| `fileChanges` | `write`, `edit`, `apply_patch` |
| `readOnly` | `read`, `ls`, `find`, `grep`, `view_image` |
| `otherTools` | Everything else, including custom, MCP, browser and external-service tools |

Classification uses exact tool names, not shell-command prefixes or guesses about code safety. Unknown tools remain reviewed by default. Skipping an outer wrapper does not skip its nested tools. Conversely, arbitrary code can perform effects without calling a nested tool, so disabling `execution` removes review of those effects.

Policy files load at session startup and through `/guardian reload`. Editing a file during a session does not change the active policy. Reload cancels pending reviews. Invalid or unreadable configuration blocks actions while Guardian is on. `/guardian status` shows the loaded scope and configuration errors. Untrusted repo configuration is ignored.

## When an action is blocked

A denial, error, timeout, malformed assessment, changed action, or stale parent stops that pending execution. Reviews have a 30-second deadline including authentication, use SSE, and make at most one inference request with no retries or fallback model. The reviewer has no tools and never executes the candidate.

After installing, resuming, changing models, or navigating the session tree, request the action again so Guardian can observe a fresh parent response. If nested preflight is unavailable, install or update Conversion before using Code Mode or Notebook Mode. `/guardian off` deliberately stops protection for the session branch.

Guardian preserves authorization and action text rather than truncating it. The complete review payload must fit within 96 KiB of UTF-8, or the parent model's smaller context limit. Image, audio, file, opaque checkpoint, and referenced-history context is not supported. Start a new text-only session with complete authorization when the context cannot be reviewed intact.

## Boundaries

Guardian is an approval layer, not an operating-system sandbox. It reviews Pi tool calls and supported Conversion preflight calls. It does not intercept user shell commands, arbitrary extension side effects, already-running processes, or direct filesystem and network access outside those boundaries. A reviewed wrapper is not a blanket authorization for later nested actions.

Extensions remain trusted host code. Guardian captures the prepared parent request at Pi's provider hook. Later extensions that replace that payload or change admitted arguments are outside its guarantee. Session, tree, compaction, model, authorization, and shutdown changes cancel pending reviews. Old replies cannot authorize a changed action or context.

Reviewer requests always use the canonical ChatGPT Codex endpoint. Final headers set `originator=codex_cli_rs`, `x-codex-guardian=reviewer`, and `x-openai-subagent=guardian`, and remove the Codex routing hint. The body carries the genuine issuing parent response ID, not a fabricated link. Guardian leaves ordinary Pi identity headers unchanged.
