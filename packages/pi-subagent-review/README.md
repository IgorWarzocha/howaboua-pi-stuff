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
/review stack=main@origin
/review stack="description(exact:'release base')" focus on migrations
```

Anything after `/review` becomes additional reviewer guidance. A leading `loop` starts review-loop mode and is removed from that guidance. In a JJ workspace, `stack=<ancestor revset>` selects a cumulative review base and is removed from that guidance; quote a revset containing spaces. Only one `stack=` argument is accepted.

Findings are advisory. The command tells the main agent to verify and categorize them against the current implementation and session context rather than treating them as a TODO list.

With a compatible optional Pi Codex Responses adapter, the review preface and triage follow-up use developer-role policy. The preface keeps its existing display and deduplication; the follow-up appears as an extension developer message rather than user input. Raw reviewer findings remain lower-authority custom-message content. Without the API or active adapter, ordinary Pi delivery is unchanged.

## Review scope

In a JJ workspace, the extension reviews the active revision before considering an enclosing Git checkout. It pins the active change and commit IDs, reviews against its direct parent by default, and uses `stack=<ancestor revset>` for a cumulative range. The active revision must be conflict-free. The read-only command reviews stored commit content; capture filesystem edits with JJ before invoking `/review`.

Elsewhere, the extension chooses among local `dev`, `main`, and `master` branches, then reviews from the merge base so committed and dirty changes are included without base-only commits. With no usable base it reviews the checkout; with no changes it reviews the latest commit.

When enabled, a separate model summarizes the current Pi branch for the reviewer; raw turns are not sent. Review continues diff-only if summarization fails.

## Review loops

`/review loop` records a review-specific marker. The next `/review` summarizes fixes since that point with the configured `summary` model, advances the marker, and starts another pass. It does not conflict with `pi-auto-trees`' `/marker`.

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

The `summary` model prepares both reviewer conversation context and review-loop increment summaries.

Do not load another extension that registers `/review` unless the command collision is intentional.
