# @howaboua/pi-extensions

The general-purpose extension bundle from this repository.

## Install

```bash
pi install npm:@howaboua/pi-extensions
```

## Included extensions

- `pi-ask` — interactive decisions, review triage, human handoffs, and optional `/fold` and `/grill` prompts
- `pi-auto-trees` — `/marker` and `/end` for incremental long sessions
- `pi-better-skills-tool` — progressive skill discovery in normal Pi, Code Mode, and Notebook Mode
- `pi-cache-hit-predictor` — inline prompt-cache hit predictions when switching models or reasoning levels
- `pi-gippity-control` — realtime voice and LAN remote control for any Pi model
- `pi-github-watch`: opt-in notifications for GitHub issue and pull request comments
- `pi-grok-realtime`: Grok voice with Pi doing the work, plus local and browser dictation
- `pi-gpt-switcher`: `/sol`, `/luna` and `/astra` shortcuts for Codex models with configurable reasoning defaults
- `pi-pet` — animated companion miniapps for GipPity Remote
- `pi-shepherdr` — Herdr-native multi-agent orchestration
- `pi-smart-btw` — async side-session questions
- `pi-subagent-review` — isolated review subagents through `/review`
- `pi-unicode-charts` — terminal-native Unicode charts for Pi Markdown

`pi-browser`, `pi-codex-conversion`, `pi-codex-web-run`, `pi-codex-imagegen`, and `pi-subdir-agents` are not included. Install them separately for logged-in browser access, Codex integration, or nested agent guidance.

`pi-agent-board`, `pi-chatgpt-sites`, `pi-codex-guardian`, `pi-notes-compaction` and `pi-sandbox` are also separate installs. They provide boards, Sites management, tool approval reviews, session notes and context rollover, and local VMs with app previews.

Installing this bundle loads every extension above. Install individual packages instead if you only want part of the set.
