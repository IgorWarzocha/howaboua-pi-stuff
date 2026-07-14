# Howaboua Pi Stuff

The Pi extensions and skills I use to keep long agent sessions useful without building a fake operating system around them.

Everything is published as a separate npm package. Install a bundle for the full setup, or pick only what you need. Revolutionary stuff. A table.

Pi packages run with your local permissions. You can obviously trust me, a stranger on the internet with a folder called `pi-stuff`, but read the source before installing it anyway.

## Bundles

| Package | Includes | Deliberate exclusions |
|---|---|---|
| [`@howaboua/pi-stuff`](./packages/pi-stuff) | 10 general extensions and 8 shareable skills | Codex conversion and Omarchy support |
| [`@howaboua/pi-extensions`](./packages/pi-extensions) | 10 general extensions | Codex conversion |
| [`@howaboua/pi-skills`](./packages/pi-skills) | 8 shareable skills | Omarchy support |

```bash
pi install npm:@howaboua/pi-stuff
# or
pi install npm:@howaboua/pi-extensions
pi install npm:@howaboua/pi-skills
```

`pi-codex-conversion` is separate because it changes Pi's tool surface for GPT/Codex models. `omarchy-help` is separate because it targets Arch desktops configured with Omarchy.

## Extensions

| Package | What it adds |
|---|---|
| [`pi-auto-reasoning-tool`](./packages/pi-auto-reasoning-tool) | An agent-callable `change_reasoning` tool with the user's selected level as its floor |
| [`pi-auto-trees`](./packages/pi-auto-trees) | `/marker` and `/end` for rolling completed work into a compact branch summary |
| [`pi-codex-conversion`](./packages/pi-codex-conversion) | Codex-shaped shell, patch, image, web, and Code Mode tools for GPT/Codex models |
| [`pi-dynamic-tools`](./packages/pi-dynamic-tools) | TOML-defined command-line tools exposed through JavaScript Code Mode |
| [`pi-explore-subagents`](./packages/pi-explore-subagents) | Isolated, discovery-only shallow and deep subagents |
| [`pi-markdown-workflows`](./packages/pi-markdown-workflows) | Workflow/skill UI, `/learn`, workflow capture, and nested `AGENTS.md` loading |
| [`pi-memories`](./packages/pi-memories) | Shutdown memory candidates in a plain Markdown inbox |
| [`pi-semantic-grep`](./packages/pi-semantic-grep) | Meaning-based code and docs search backed by repo-local SQLite indexes |
| [`pi-smart-btw`](./packages/pi-smart-btw) | Async side-session questions with explicit injection into the main chat |
| [`pi-subagent-review`](./packages/pi-subagent-review) | `/review` through an isolated review subagent |
| [`pi-vent`](./packages/pi-vent) | Batched notes about repeated workflow friction in `VENT.md` |

## Skills

| Package | Use it for |
|---|---|
| [`pi-skill-agent-native-hardening`](./packages/pi-skill-agent-native-hardening) | Architecture reviews and refactors for clearer ownership and safer changes |
| [`pi-skill-agents-md`](./packages/pi-skill-agents-md) | Creating, auditing, and pruning scoped `AGENTS.md` files |
| [`pi-skill-anti-ai-copy`](./packages/pi-skill-anti-ai-copy) | Specific, natural prose that preserves the author's voice |
| [`pi-skill-chrome-cdp`](./packages/pi-skill-chrome-cdp) | Inspecting and controlling a local Chrome-family browser through CDP |
| [`pi-skill-gh-issue-pr-flow`](./packages/pi-skill-gh-issue-pr-flow) | GitHub issue, branch, PR, release, and review workflows |
| [`pi-skill-model-facing-api-design`](./packages/pi-skill-model-facing-api-design) | Tool contracts that models select and call correctly |
| [`pi-skill-project-reference-research`](./packages/pi-skill-project-reference-research) | Evidence-backed research in local or external repositories |
| [`pi-skill-skill-creator`](./packages/pi-skill-skill-creator) | Creating, auditing, and packaging reusable agent skills |
| [`pi-skill-omarchy-help`](./packages/pi-skill-omarchy-help) | User-level maintenance for Arch desktops configured with Omarchy |

Pi discovers installed skills automatically and loads them when a task matches. Use `/skill:<name>` when you want to invoke one explicitly.

## How I use it

Map an unfamiliar repo, set `/marker` once the useful context is in place, implement one coherent change, and run `/review`. After triage and QA, `/end` carries the accepted result forward. Broad changes get an `agent-native-hardening` pass.

For UI work, I give the agent references first—apps, screenshots, and interface details I like—then iterate through browser inspection and screenshots. One-shotting a good frontend is mostly a party trick.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md). Package-level changelogs remain beside packages that have them.

## License

Individual packages include their own license files. They are MIT-licensed unless noted in the package directory.
