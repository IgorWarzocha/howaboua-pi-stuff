# @howaboua/pi-markdown-workflows

Manages repository workflows and reusable skills from one Pi interface, and loads nested `AGENTS.md` context when work enters a subdirectory.

## Install

```bash
pi install npm:@howaboua/pi-markdown-workflows
```

For local development:

```bash
pi -e ./packages/pi-markdown-workflows/index.ts
```

## Commands

- `/workflows` — browse, create, use, refine, promote, reference, or delete repository workflows
- `/skills` — browse, create, use, refine, or delete skills
- `/learn [guidance]` — ask the agent to capture a small durable lesson in the narrowest useful `AGENTS.md`

Use `Tab` and `Shift+Tab` to switch between workflows and skills in the shared UI. If Pi's generated `/skill:<name>` commands clutter the command palette, disable **skill commands** in `/settings` and use `/skills` instead.

## Workflows and skills

- Workflows are repository procedures stored at `.pi/workflows/<slug>/SKILL.md`.
- Skills are broader reusable capabilities, commonly stored at `~/.pi/agent/skills/`.

The agent-callable `workflows_create` tool writes or updates confirmed repeatable procedures under `.pi/workflows/`. The UI can also append a compact workflow reference to the relevant `AGENTS.md` or promote a workflow into a skill.

## Nested `AGENTS.md` loading

The extension detects file reads and read-like shell or Code Mode operations. When a path enters a subtree, it injects the applicable nested `AGENTS.md` chain without reinjecting the repository root file Pi already loaded. It refreshes known context every 10 qualifying operations so edits made during a long session take effect.

The package uses `@howaboua/pi-howaboua-extensions-primitives-sdk` for its UI. Published installs load compiled `dist/`; repository development runs the TypeScript entrypoint above.

Repository: <https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-markdown-workflows>
