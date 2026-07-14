# @howaboua/pi-extensions

The general-purpose extension bundle from this repository.

## Install

```bash
pi install npm:@howaboua/pi-extensions
```

## Included extensions

- `pi-auto-reasoning-tool` — agent-controlled reasoning levels with the user's level as a floor
- `pi-auto-trees` — `/marker` and `/end` for incremental long sessions
- `pi-dynamic-tools` — TOML-defined command tools through JavaScript Code Mode
- `pi-explore-subagents` — isolated, discovery-only subagents
- `pi-markdown-workflows` — workflow/skill UI and nested `AGENTS.md` loading
- `pi-memories` — shutdown memory candidates in a Markdown inbox
- `pi-semantic-grep` — semantic code and docs search
- `pi-smart-btw` — async side-session questions
- `pi-subagent-review` — isolated review subagents through `/review`
- `pi-vent` — repeated workflow-friction notes in `VENT.md`

`pi-codex-conversion` is not included because it changes the tool surface for GPT/Codex models. Install it separately when you want that behavior.

Installing this bundle loads every extension above. Install individual packages instead if you only want part of the set.
