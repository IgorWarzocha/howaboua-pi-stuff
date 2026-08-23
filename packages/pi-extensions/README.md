# @howaboua/pi-extensions

The general-purpose extension bundle from this repository.

## Install

```bash
pi install npm:@howaboua/pi-extensions
```

## Included extensions

- `pi-ask` — interactive decisions, review triage, human handoffs, and optional `/fold` and `/grill` prompts
- `pi-auto-reasoning-tool` — agent-controlled reasoning levels with the user's level as a floor
- `pi-auto-trees` — `/marker` and `/end` for incremental long sessions
- `pi-cache-hit-predictor` — inline prompt-cache hit predictions when switching models or reasoning levels
- `pi-dynamic-tools` — TOML-defined command tools through JavaScript Code Mode
- `pi-explore-subagents` — isolated, discovery-only subagents
- `pi-gpt-switcher` — `/sol`, `/terra`, and `/luna` commands for GPT-5.6 Codex models
- `pi-markdown-workflows` — workflow/skill UI and workflow capture
- `pi-memories` — shutdown memory candidates in a Markdown inbox
- `pi-semantic-grep` — semantic code and docs search
- `pi-smart-btw` — async side-session questions
- `pi-subagent-review` — isolated review subagents through `/review`
- `pi-vent` — repeated workflow-friction notes in `VENT.md`

The Codex conversion packages are not included because they change the GPT/Codex tool surface. Install one separately when you want that behavior.

Installing this bundle loads every extension above. Install individual packages instead if you only want part of the set.
