# Howaboua Pi Stuff

This is my Pi toolbox: the extensions and skills I use to keep agent sessions moving without building a whole fake operating system around them.

Everything here is still published as separate npm packages. Install the full bundle if you want my setup, or pick the one package you actually need. Revolutionary stuff. A table.

Pi packages run with your local permissions. You can obviously trust me, a stranger on the internet with a folder called `pi-stuff`, but maybe read the package before installing it anyway.

## Packages

GitHub does not render proper copy-button codeblocks inside Markdown tables. So you get a long list instead. At least the commands copy cleanly. Or send your clanker here to argue about which ones you actually want.

### Bundles

#### `pi-stuff`

General setup: extensions plus shareable skills. Excludes Codex conversion and Omarchy because those depend on your model/workstation setup.

```bash
pi install npm:@howaboua/pi-stuff
```

#### `pi-extensions`

General extension packages. Excludes `pi-codex-conversion`; install that separately if you run Codex/GPT models and want native-tool adaptation.

```bash
pi install npm:@howaboua/pi-extensions
```

#### `pi-skills`

Shareable skill packages. Excludes `omarchy-help` because not everyone is running my kind of desktop setup.

```bash
pi install npm:@howaboua/pi-skills
```

### Extensions

#### `pi-codex-conversion`

Codex-style tools for Pi: `exec_command`, `write_stdin`, `apply_patch`, image tools, native Codex web search, and prompt/tool adaptation.

```bash
pi install npm:@howaboua/pi-codex-conversion
```

#### `pi-auto-reasoning-tool`

Gives the agent a `change_reasoning` tool so it can raise/lower reasoning level when the work changes shape.

```bash
pi install npm:@howaboua/pi-auto-reasoning-tool
```

#### `pi-auto-trees`

Adds `/marker` and `/end` for long sessions. Set a useful return point, summarize what was accomplished, then keep going.

```bash
pi install npm:@howaboua/pi-auto-trees
```

#### `pi-subagent-review`

Adds `/review`, an isolated review subagent that checks the right branch/range and returns findings for the main agent to address.

```bash
pi install npm:@howaboua/pi-subagent-review
```

#### `pi-semantic-grep`

Adds `semantic_grep`, a meaning-based code/docs search tool backed by local SQLite indexes and OpenAI-compatible embeddings.

```bash
pi install npm:@howaboua/pi-semantic-grep
```

#### `pi-vent`

Adds `vent`, a small tool for logging repeated workflow friction into `VENT.md`.

```bash
pi install npm:@howaboua/pi-vent
```

#### `pi-explore-subagents`

Adds `explore_subagent`, discovery-only shallow/deep subagents for reading and summarizing code without editing files.

```bash
pi install npm:@howaboua/pi-explore-subagents
```

#### `pi-markdown-workflows`

Adds `/skills`, `/workflows`, workflow capture, `/learn`, and nested `AGENTS.md` context loading.

```bash
pi install npm:@howaboua/pi-markdown-workflows
```

#### `pi-smart-btw`

Side-session questions with explicit injection back into the main chat. Useful when you want a tangent without derailing the main thread.

```bash
pi install npm:@howaboua/pi-smart-btw
```

#### `pi-memories`

KISS local memory for Pi based on global `AGENTS.md`.

```bash
pi install npm:@howaboua/pi-memories
```

### Skills

#### `pi-skill-agent-native-hardening`

Refactor/audit posture for agent-built code: fewer godfiles, clearer ownership, less duplication, better traversability.

```bash
pi install npm:@howaboua/pi-skill-agent-native-hardening
```

#### `pi-skill-anti-ai-copy`

Rewrites text so it sounds specific, human, and less like a polite SaaS brochure.

```bash
pi install npm:@howaboua/pi-skill-anti-ai-copy
```

#### `pi-skill-chrome-cdp`

Browser inspection/control through Chrome DevTools Protocol. Based on [`pasky/chrome-cdp-skill`](https://github.com/pasky/chrome-cdp-skill), with local Pi packaging changes.

```bash
pi install npm:@howaboua/pi-skill-chrome-cdp
```

#### `pi-skill-gh-issue-pr-flow`

A generic GitHub issue/PR workflow with `gh`, branches, validation, PR bodies, and review triage.

```bash
pi install npm:@howaboua/pi-skill-gh-issue-pr-flow
```

#### `pi-skill-agents-md`

Writes, audits, and trims scoped `AGENTS.md` files without turning them into repo summaries.

```bash
pi install npm:@howaboua/pi-skill-agents-md
```

#### `pi-skill-model-facing-api-design`

Helps design compact Pi tool names, descriptions, schemas, snippets, and guidelines that models call correctly.

```bash
pi install npm:@howaboua/pi-skill-model-facing-api-design
```

#### `pi-skill-project-reference-research`

Looks up external or local repos as reference context, then returns evidence-backed findings.

```bash
pi install npm:@howaboua/pi-skill-project-reference-research
```

#### `pi-skill-skill-creator`

Helps design, write, package, and tighten reusable agent skills.

```bash
pi install npm:@howaboua/pi-skill-skill-creator
```

#### `pi-skill-omarchy-help`

Generic Arch + Omarchy workstation maintenance. Install separately and customize it for your own machine.

```bash
pi install npm:@howaboua/pi-skill-omarchy-help
```

## The workflow

A normal session is not fancy:

1. Start Pi and ask the agent to familiarise itself with the repo, usually with discovery subagents. (`pi-explore-subagents`, `pi-semantic-grep`)
2. Pull in GitHub issues, or ask the agent to group open issues into something PR-sized. (`pi-skill-gh-issue-pr-flow`)
3. Use `/marker` once the agent has enough baseline context. (`pi-auto-trees`)
4. Work on one issue or feature. (`pi-codex-conversion`, `pi-auto-reasoning-tool`)
5. Run `/review`, fix what is actually worth fixing, then review again if needed. (`pi-subagent-review`)
6. Open a PR and use external review feedback as another pass. (`pi-skill-gh-issue-pr-flow`)
7. Do manual QA and try to break the feature. (your eyes, sadly still required)
8. Use `/end` to summarize what changed and advance the marker. (`pi-auto-trees`)
9. Continue from the new marker for the next feature. (`pi-auto-trees`)
10. After larger changes, ask for a hardening pass to modularise the result and remove obvious slop. (`pi-skill-agent-native-hardening`)

The point is not loops, worker swarms, or pretending the agent is magic. It is a few raw Pi sessions, clear context boundaries, review passes, and enough tooling to stop long sessions from turning into archaeology.

For UI work, I usually give the agent a reference frame first: apps to inspect, screenshots, bits of interface I like. The agent builds a mock, then I iterate with browser control, screenshots, and human taste. One-shotting a good frontend is mostly a party trick.

## Other skills I use

A few useful skills are intentionally not in the bundles because they are either very taste-specific, UI/design-specific, or better installed from their own source:

- [`impeccable`](https://github.com/pbakaus/impeccable) by Peter Bakaus: high-quality frontend/interface generation.
- [`make-interfaces-feel-better`](https://github.com/jakubkrehel/make-interfaces-feel-better) by Jakub Krehel: UI microdetails, interaction polish, spacing, shadows, motion, all the fiddly bits.
- [`design-md`](https://github.com/google-labs-code/design.md): useful when working with Google Labs’ `DESIGN.md` spec and `@google/design.md` CLI.
- [`agent-pages`](https://github.com/IgorWarzocha/agent-pages): useful for rich local proposal/report/mockup surfaces, but not something I want to force into the default bundle.
- [React Grab](https://github.com/aidenybai/react-grab) by Aiden Bai is not a Pi skill here, but it is extremely useful for React UI iteration.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md). Package-level changelogs remain next to their packages where they exist.

## License

Individual packages keep their own license files. Current packages are MIT-licensed unless noted in the package directory.
