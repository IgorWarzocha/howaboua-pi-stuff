# @howaboua/pi-subagent-review

Adds `/review`, which sends the current repository state to an isolated review subagent and injects its findings back into the main session for triage.

## Install

```bash
pi install npm:@howaboua/pi-subagent-review
```

Run `/reload` after installation if Pi is already open.

## Usage

```text
/review
/review focus on migrations and tests
/review loop
```

Anything after `/review` becomes additional reviewer guidance. A leading `loop` starts review-loop mode and is removed from that guidance.

Findings are advisory. The command tells the main agent to verify and categorize them against the current implementation and session context rather than treating them as a TODO list.

## Review scope

The extension chooses among local `dev`, `main`, and `master` branches, then reviews from the merge base so committed and dirty changes are included without base-only commits. With no usable base it reviews the checkout; with no changes it reviews the latest commit.

When enabled, a separate model summarizes the current Pi branch for the reviewer; raw turns are not sent. Review continues diff-only if summarization fails.

## Review loops

`/review loop` records a review-specific marker. The next `/review` compacts fixes since that point, advances the marker, and starts another pass. It does not conflict with `pi-auto-trees`' `/marker`.

## Configuration

On first load, the extension creates `~/.pi/agent/pi-subagent-review.json`, or the equivalent path under `$PI_CODING_AGENT_DIR`.

```json
{
  "model": "openai-codex/gpt-5.6-sol",
  "thinking": "medium",
  "summary": {
    "enabled": true,
    "model": "openai-codex/gpt-5.6-luna",
    "thinking": "low"
  }
}
```

Models use Pi's `provider/model` format. Thinking levels through `max` are accepted and clamped. If a configured model is unavailable, the command falls back to the current session model.

Do not load another extension that registers `/review` unless the command collision is intentional.
