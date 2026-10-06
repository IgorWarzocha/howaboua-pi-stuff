# Pi Codex Guardian

Review or block pending Pi tool calls that match your explicit rules. Rules name an exact tool and optionally match its arguments with regexes. There are no default rules. Without configuration, every call passes through with no reviews or blocks. Native Pi and nested Code Mode and Notebook Mode calls use the same rules.

Guardian turns on when installed. Reviews require Pi 1.0.4 or later, ChatGPT OAuth sign-in, and a current parent response using the Codex Responses API at the canonical ChatGPT endpoint. Matching review calls are blocked on other models or unverified parent responses. Matching block calls never contact the reviewer and need no Codex parent. Unmatched calls need no parent. With rules loaded, Code Mode and Notebook Mode additionally require Pi Codex Conversion 3.0.46 or later.

## Install

```sh
pi install npm:@howaboua/pi-codex-guardian
```

Add rules below, then start a new Pi session with a signed-in Codex model. For matching review calls, Guardian sends the selected parent instructions, transcript, tool declarations, and exact pending action to `codex-auto-review`. Installing alongside Conversion uses its currently registered provider automatically. Native Pi works without Conversion.

Parent observation and credit requests run only while review rules are loaded and enabled. Block-only and empty policies do not request credits. Credit requests require the native ChatGPT subscription backend, stored subscription credentials, and canonical model and provider endpoints. Configured API-key handlers, runtime keys, custom authentication and legacy stream overrides do not qualify. Guardian reviewer requests never request parent credits. These checks follow the client-side eligibility contract; the backend's billing decision is not observable here.

## Control

```text
/guardian status
/guardian on
/guardian off
/guardian reload
```

The setting persists in the selected session branch. New sessions default to on. `/guardian` without arguments shows status. Only the user command changes the setting. Guardian adds no agent tool or standing prompt.

Status shows loaded review and block counts, whether nested preflight is available, and the last completed verdict. Zero rules is explicitly reported as no reviews or blocks. Review token counts are not charges. Guardian billing eligibility and per-review cost have not been established, so this package makes no zero-cost claim.

## Rules

Use either file:

- Global: `~/.pi/agent/pi-codex-guardian.json`, respecting `PI_CODING_AGENT_DIR`.
- Repo: `.pi/pi-codex-guardian.json` in the Pi session's working directory. Parent directories are not searched. Pi must trust the folder.

```json
{
  "rules": [
    { "tool": "bash", "args": { "command": "\\brm\\b.*-rf" }, "action": "review" },
    { "tool": "exec_command", "args": { "cmd": "\\brm\\b.*-rf" }, "action": "block" }
  ]
}
```

This example reviews native `bash` calls whose `command` matches the pattern and blocks nested `exec_command` calls whose `cmd` matches it. These are text patterns, not shell parsing. They do not identify every equivalent command or interpret command safety.

- `tool` is a literal tool name. No glob, regex, prefix, or category matching.
- Omit `args`, or use `{}`, to match every call to that tool.
- `args` keys are exact top-level argument properties. Values are JavaScript regex strings without flags or `/.../` delimiters. Matching uses substring search unless you add anchors.
- Every argument predicate in a rule must match. Missing, inherited, and non-string arguments do not match. Values are never coerced to strings.
- Any matching rule applies. `block` wins over `review` regardless of rule order. Unmatched calls pass through.
- Global and trusted repo rules add together. Repo rules cannot remove global restrictions.

Rules see prepared tool arguments. Supported aliases such as nested `exec_command`'s `command` are resolved to `cmd` before matching.

An unmatched `exec`, `wait`, or `notebook` wrapper does not trigger an outer review. Its nested calls still match their own rules. To review arbitrary wrapper source itself, add an explicit wrapper rule, such as `{ "tool": "exec", "action": "review" }`. Arbitrary wrapper code can perform effects without calling a nested tool.

Files load at session startup and through `/guardian reload`. Editing a file during a session does not change the active rules. Reload cancels pending matching and reviews. Invalid or unreadable configuration blocks actions while Guardian is on. Untrusted repo configuration is ignored. Revoking trust from loaded repo rules requires a reload before actions can continue. The former category configuration is not accepted.

Each file is limited to 64 KiB and 256 rules. Each regex is limited to 4,096 characters. Regex predicates run in an isolated Node process with a 32 MiB heap limit and a one-second deadline including startup. Argument strings sent to that process are limited to 1 MiB total per call, counting repeated predicates. Timeout, cancellation, memory exhaustion, or matching failure blocks that action rather than hanging Pi or silently passing it. Invalid regex syntax is reported when loading the file. If Pi runs on Bun, Node must also be available on `PATH`. Missing Node is reported in `/guardian status`, with no unbounded matching fallback.

## When an action is blocked

A denial, error, timeout, malformed assessment, changed action, or stale parent stops that pending execution. Reviews have a 30-second deadline including authentication, use SSE, and make at most one inference request with no retries or fallback model. The reviewer has no tools and never executes the candidate.

For review rules, after installing, resuming, changing models, or navigating the session tree, request the action again so Guardian can observe a fresh parent response. If rules are loaded and nested preflight is unavailable, install or update Conversion before using Code Mode or Notebook Mode. Without rules, missing preflight does not block execution. `/guardian off` deliberately disables rules for the session branch.

Guardian preserves authorization and action text rather than truncating it. The complete review payload must fit within 96 KiB of UTF-8, or the parent model's smaller context limit. Image, audio, file, opaque checkpoint, and referenced-history context is not supported. Start a new text-only session with complete authorization when the context cannot be reviewed intact.

## Boundaries

Guardian is an approval layer, not an operating-system sandbox. It reviews Pi tool calls and supported Conversion preflight calls. It does not intercept user shell commands, arbitrary extension side effects, already-running processes, or direct filesystem and network access outside those boundaries. A reviewed wrapper is not a blanket authorization for later nested actions.

Extensions remain trusted host code. Guardian captures the prepared parent request at Pi's provider hook. Later extensions that replace that payload or change admitted arguments are outside its guarantee. Session, tree, compaction, model, authorization, and shutdown changes cancel pending reviews. Old replies cannot authorize a changed action or context.

Reviewer requests use the canonical ChatGPT Codex endpoint and identify as `codex_cli_rs` Guardian reviews, with a truthful adapter User-Agent and a separate review session. Headers and body metadata share the review's identity and actual Pi parent session. The body carries the genuine issuing parent response ID. Stale parent routing, feature, attestation, and tracing claims are not reused. Ordinary Pi identity headers remain unchanged.

See the [protocol mapping](PROTOCOL.md) for the complete eligibility, header, environment, metadata, and body contract, including deliberate differences from the Codex runtime.
