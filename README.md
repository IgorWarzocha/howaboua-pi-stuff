# Howaboua Pi Stuff

The Pi extensions and skills I use to keep long agent sessions useful without building a fake operating system around them.

Everything is published as a separate npm package. Install a bundle for the full setup, or pick only what you need. Revolutionary stuff. A table.

Pi packages run with your local permissions. You can obviously trust me, a stranger on the internet with a folder called `pi-stuff`, but read the source before installing it anyway.

## Bundles

| Package | Includes | Deliberate exclusions |
|---|---|---|
| [`@howaboua/pi-stuff`](./packages/pi-stuff) | 16 general extensions and 15 shareable skills | Codex conversion, Omarchy support, and the standalone nested AGENTS loader |
| [`@howaboua/pi-extensions`](./packages/pi-extensions) | 16 general extensions | Codex conversion and the standalone nested AGENTS loader |
| [`@howaboua/pi-skills`](./packages/pi-skills) | 15 shareable skills | Omarchy support |

```bash
pi install npm:@howaboua/pi-stuff
# or
pi install npm:@howaboua/pi-extensions
pi install npm:@howaboua/pi-skills
```

`pi-codex-conversion` is separate because it changes Pi's tool surface for GPT/Codex models. `pi-codex-web-run` and `pi-codex-imagegen` are separate because they use Codex endpoints and login. `omarchy-help` is separate because it targets Arch desktops configured with Omarchy.

## Extensions

| Package | What it adds |
|---|---|
| [`pi-ask`](./packages/pi-ask) | Interactive user decisions, review triage, and human handoffs |
| [`pi-auto-trees`](./packages/pi-auto-trees) | `/marker` and `/end` for rolling completed work into a compact branch summary |
| [`pi-cache-hit-predictor`](./packages/pi-cache-hit-predictor) | Inline prompt-cache hit predictions when switching models or reasoning levels |
| [`pi-codex-conversion`](./packages/pi-codex-conversion) | Codex-shaped shell, patch, image inspection, and Code Mode tools for GPT/Codex models |
| [`pi-dynamic-tools`](./packages/pi-dynamic-tools) | TOML-defined command-line tools exposed through JavaScript Code Mode |
| [`pi-explore-subagents`](./packages/pi-explore-subagents) | Isolated, discovery-only shallow and deep subagents |
| [`pi-gippity-control`](./packages/pi-gippity-control) | Realtime voice and LAN remote control for any Pi model |
| [`pi-gpt-switcher`](./packages/pi-gpt-switcher) | `/sol`, `/terra`, and `/luna` commands for GPT-5.6 Codex models |
| [`pi-codex-imagegen`](./packages/pi-codex-imagegen) | Codex image generation and editing in normal Pi, Code Mode, and Notebook Mode |
| [`pi-memories`](./packages/pi-memories) | Shutdown memory candidates in a plain Markdown inbox |
| [`pi-pet`](./packages/pi-pet) | Animated companion miniapps for GipPity Remote |
| [`pi-semantic-grep`](./packages/pi-semantic-grep) | Meaning-based code and docs search backed by repo-local SQLite indexes |
| [`pi-shepherdr`](./packages/pi-shepherdr) | Herdr-native multi-agent orchestration |
| [`pi-skills-tool`](./packages/pi-skills-tool) | Progressive skill discovery in normal Pi, Code Mode, and Notebook Mode |
| [`pi-smart-btw`](./packages/pi-smart-btw) | Async side-session questions with explicit injection into the main chat |
| [`pi-subagent-review`](./packages/pi-subagent-review) | `/review` through an isolated review subagent |
| [`pi-subdir-agents`](./packages/pi-subdir-agents) | Nested `AGENTS.md` context during repository discovery |
| [`pi-unicode-charts`](./packages/pi-unicode-charts) | Terminal-native Unicode charts for Pi Markdown |
| [`pi-vent`](./packages/pi-vent) | Batched notes about repeated workflow friction in `VENT.md` |
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

## How I use it

Map an unfamiliar repo, set `/marker` once the useful context is in place, implement one coherent change, and run `/review`. After triage and QA, `/end` carries the accepted result forward. Broad changes get a codebase-hygiene pass.

For UI work, I give the agent references first—apps, screenshots, and interface details I like—then iterate through browser inspection and screenshots. One-shotting a good frontend is mostly a party trick.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md). Package-level changelogs remain beside packages that have them.

## License

Individual packages include their own license files. They are MIT-licensed unless noted in the package directory.
