# pi-subagent-review

`@howaboua/pi-subagent-review` is a Pi extension that adds one slash command:

- `/review`
- `/review loop`

It runs an isolated review subagent against your current repo, optionally prepares a compact conversation-context summary first, injects the findings back into the session as a user message, and asks the main agent to triage those advisory findings before deciding what to address. It is modelled after Codex CLI's /review command.

## What it does

`/review`:
- detects the current git repo
- chooses a base branch automatically
- computes the merge base with `HEAD`
- if no usable base branch or merge base exists, reviews the current checkout as-is
- if the checkout is clean and has no diff against the selected base, reviews the latest commit instead of stopping early
- inspects committed and dirty worktree changes
- summarizes the current Pi session branch as review context, when enabled
- runs an isolated review subagent
- sends the findings back into the current Pi session as a user message
- makes clear that the findings are advisory, not direct user instructions, so the main agent should triage them against prior context before editing

`/review loop` starts a review loop. It sets a review-specific marker at the current conversation point, strips the `loop` word from the review guidance, and then runs the normal review.

The first `/review` in a session branch also adds a visible advisory preface without starting an agent turn. The preface reminds the main agent that review findings are advisory and should be triaged against the current task, prior conversation, architectural decisions, and accepted tradeoffs before coding.

After that, plain `/review` detects the active review marker, summarizes the work since that marker back into a compact review-fix increment, advances the review marker, and then runs the next isolated review pass from the compacted point. If the stored marker is gone, `/review` simply behaves like a normal review.

The review marker is separate from `@howaboua/pi-auto-trees`' generic `/marker`, so both extensions can be used in the same session.

While `/review` is running, the extension shows a small review widget above the editor with one of two states:

- `Preparing review context…`
- `Reviewing changes…`

The widget is UI-only and is cleared when the command finishes, fails, or is cancelled.

## Automatic base branch selection

The command chooses the base branch automatically:

- if you are on a branch other than `main`, `master`, or `dev`, it reviews against `dev`
- if no local `dev` exists, it falls back to `main`, then `master`
- if you are on `dev`, it reviews against `main`, then `master`
- if you are on `main` or `master`, it prefers `dev` when available

This means you usually never need to specify the diff base manually.

## User arguments

Anything after `/review` is treated as extra review guidance.

If the first word is `loop` in any casing, it starts review-loop mode and that word is removed from the review guidance.

Examples:

```text
/review
/review loop
/review LoOp focus extra attention on migrations and tests
/review focus extra attention on migrations and tests
/review assess whether we introduced new UI elements instead of reusing established components and existing CSS patterns
```

## Config

On first load, the extension creates:

- `~/.pi/agent/pi-subagent-review.json`

If Pi is using a custom agent directory via `PI_CODING_AGENT_DIR`, the file is created there instead.

Edit that file to change the default review model or thinking level, and the model used to summarize conversation context before review:

```json
{
  "model": "openai-codex/gpt-5.5",
  "thinking": "medium",
  "summary": {
    "enabled": true,
    "model": "openai/gpt-5.4-mini",
    "thinking": "low"
  }
}
```

The summary model uses the same `provider/model` string format as the reviewer model. The generated summary is injected into the isolated review task as branch-style context; raw conversation turns are not sent to the review subagent. If the configured review or summary model is not available for the user, `/review` falls back to the current session model automatically. If conversation summarization still fails, `/review` continues with a diff-only review.

Existing config files from older versions are migrated on load. If a config has `model` and `thinking` but no `summary` block, the extension adds one using the same model and low thinking:

```json
{
  "summary": {
    "enabled": true,
    "model": "<existing review model>",
    "thinking": "low"
  }
}
```

If a `summary` block already exists, it is left unchanged.

## Install

Installation methods:

```bash
pi install /absolute/path/to/pi-subagent-review
pi install npm:@howaboua/pi-subagent-review
pi install git:github.com/IgorWarzocha/pi-subagent-review
```

Then reload or restart Pi.

## Notes

- This extension registers `/review`.
- Do not load it together with another extension that also registers `/review` unless you intentionally want that command collision.
