# Howaboua Pi Stuff

The Pi extensions and skills I use to keep long agent sessions useful without building a fake operating system around them.

Published packages can be installed individually or in a general-purpose bundle. Pick only what you need. Revolutionary stuff. A table.

Pi packages run with your local permissions. You can obviously trust me, a stranger on the internet with a folder called `pi-stuff`, but read the source before installing it anyway.

## Bundles

| Package | Includes | Deliberate exclusions |
|---|---|---|
| [`@howaboua/pi-stuff`](./packages/pi-stuff) | 13 general extensions and 15 shareable skills | Agent Board, Browser, Sites, Notes Compaction, Observatory, Sandbox, Codex extensions, nested AGENTS loader and Omarchy support |
| [`@howaboua/pi-extensions`](./packages/pi-extensions) | 13 general extensions | Agent Board, Browser, Sites, Notes Compaction, Observatory, Sandbox, Codex extensions and nested AGENTS loader |
| [`@howaboua/pi-skills`](./packages/pi-skills) | 15 shareable skills | Omarchy support |

```bash
pi install npm:@howaboua/pi-stuff
# or
pi install npm:@howaboua/pi-extensions
pi install npm:@howaboua/pi-skills
```

`pi-codex-conversion` is separate because it changes Pi's tool surface for GPT/Codex models. `pi-codex-web-run` and `pi-codex-imagegen` are separate because they use Codex endpoints and login. `omarchy-help` is separate because it targets Arch desktops configured with Omarchy.

Install `pi-browser` separately for logged-in browser control. The standalone `pi-subdir-agents` loader is also opt-in.

Install `pi-agent-board` separately for message boards and the `/board` browser viewer. Shepherdr connects its agents to boards when that extension is loaded.

Install `pi-observatory` separately for local session usage, tool outcomes and custom collector dashboards. `/observatory` opens the viewer; `/observatory agent <scope>` asks your current agent to investigate recorded evidence.

`pi-notes-compaction`, `pi-sandbox` and `pi-chatgpt-sites` are also separate installs for session notes and context rollover, local VMs and app previews, and ChatGPT Sites management.

Install `pi-codex-guardian` separately for tool-call approval reviews. It requires a ChatGPT-backed Codex model and blocks tools when a review cannot complete.

## Extensions

| Package | What it adds |
|---|---|
| [`pi-agent-board`](./packages/pi-agent-board) | Standalone agent boards and the read-only `/board` browser viewer |
| [`pi-ask`](./packages/pi-ask) | Interactive user decisions, review triage, and human handoffs |
| [`pi-auto-trees`](./packages/pi-auto-trees) | `/marker` and `/end` for rolling completed work into a compact branch summary |
| [`pi-better-skills-tool`](./packages/pi-better-skills-tool) | Progressive skill discovery in normal Pi, Code Mode, and Notebook Mode |
| [`pi-browser`](./packages/pi-browser) | Logged-in browser control with local CDP sessions and SSH host routing |
| [`pi-cache-hit-predictor`](./packages/pi-cache-hit-predictor) | Inline prompt-cache hit predictions when switching models or reasoning levels |
| [`pi-chatgpt-sites`](./packages/pi-chatgpt-sites) | ChatGPT Sites management, committed-source saves and deployment |
| [`pi-codex-conversion`](./packages/pi-codex-conversion) | Codex-shaped shell, patch, image inspection, and Code Mode tools for GPT/Codex models |
| [`pi-codex-guardian`](./packages/pi-codex-guardian) | Guardian approval reviews before tool execution in native Pi, Code Mode, and Notebook Mode |
| [`pi-gippity-control`](./packages/pi-gippity-control) | Realtime voice and LAN remote control for any Pi model |
| [`pi-github-watch`](./packages/pi-github-watch) | Opt-in notifications when GitHub issue or pull request comments arrive |
| [`pi-grok-realtime`](./packages/pi-grok-realtime) | Grok voice with Pi doing the work, local and browser dictation, and custom voice tools |
| [`pi-gpt-switcher`](./packages/pi-gpt-switcher) | `/sol`, `/luna` and `/astra` shortcuts for Codex models with configurable reasoning defaults |
| [`pi-codex-imagegen`](./packages/pi-codex-imagegen) | Codex image generation and editing in normal Pi, Code Mode, and Notebook Mode |
| [`pi-notes-compaction`](./packages/pi-notes-compaction) | Provider-neutral session notes, shared-agent notes and notes-guided context rollover |
| [`pi-observatory`](./packages/pi-observatory) | Local session usage and outcome dashboard, custom collectors and on-demand agent investigations |
| [`pi-pet`](./packages/pi-pet) | Animated companion miniapps for GipPity Remote |
| [`pi-sandbox`](./packages/pi-sandbox) | Persistent local VMs, guest commands, supervised services and app previews |
| [`pi-shepherdr`](./packages/pi-shepherdr) | Herdr-native multi-agent orchestration |
| [`pi-smart-btw`](./packages/pi-smart-btw) | Async side-session questions with explicit injection into the main chat |
| [`pi-subagent-review`](./packages/pi-subagent-review) | `/review` through an isolated review subagent |
| [`pi-subdir-agents`](./packages/pi-subdir-agents) | Nested `AGENTS.md` context during repository discovery |
| [`pi-suggestions`](./packages/pi-suggestions) | Opt-in next-prompt drafts with `/suggestions` model settings |
| [`pi-unicode-charts`](./packages/pi-unicode-charts) | Terminal-native Unicode charts for Pi Markdown |
| [`pi-codex-web-run`](./packages/pi-codex-web-run) | Codex web search and navigation in normal Pi, Code Mode, and Notebook Mode |

## Skills

| Package | Use it for |
|---|---|
| [`pi-skill-chrome-cdp`](./packages/pi-skill-chrome-cdp) | Inspecting and controlling a local Chrome-family browser through CDP |
| [`pi-skill-code`](./packages/pi-skill-code) | Reviewing, changing, researching, and delivering maintained code |
| [`pi-skill-foundations`](./packages/pi-skill-foundations) | Scoped agent guidance, clear communication, and reusable skill maintenance |
| [`pi-skill-harness-and-agent-engineering`](./packages/pi-skill-harness-and-agent-engineering) | Diagnosing, designing, auditing, and calibrating agent harnesses |
| [`pi-skill-omarchy-help`](./packages/pi-skill-omarchy-help) | User-level maintenance for Arch desktops configured with Omarchy |

Pi discovers installed skills automatically and loads them when a task matches. Use `/skill:<name>` when you want to invoke one explicitly.

## Source-only extensions

[`pi-chill`](./packages/pi-chill) folds routine tool activity into expandable progress blocks. It is a customisable starting point, installed from a checkout rather than npm, and is not included in the bundles.

## Build an integration

The [extension API guide](./docs/extension-apis.md) covers Board and Notes with other subagent extensions, PCC tool and context APIs, voice tools, and browser miniapps. It includes lifecycle diagrams, public contracts and small integration examples.

[How we test changes in a sandbox](./docs/e2e-sandboxing-test-procedure/) explains our reviewer workflow, model and provider comparisons, and headless application checks.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md). Package-level changelogs remain beside packages that have them.

## License

Individual packages include their own license files. They are MIT-licensed unless noted in the package directory.

[![Star history](https://api.star-history.com/svg?repos=IgorWarzocha/howaboua-pi-stuff&type=Date)](https://star-history.com/#IgorWarzocha/howaboua-pi-stuff&Date)
