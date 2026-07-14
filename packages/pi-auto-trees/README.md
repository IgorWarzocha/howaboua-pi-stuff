# @howaboua/pi-auto-trees

Adds two commands for carrying useful context through long Pi sessions without keeping every dead end and debugging turn.

## Install

```bash
pi install npm:@howaboua/pi-auto-trees
```

Try it for one session:

```bash
pi -e npm:@howaboua/pi-auto-trees
```

## Usage

1. Run `/marker` after repo exploration, planning, or another stable checkpoint.
2. Complete a coherent chunk of work.
3. Run `/end`.

`/end` summarizes the branch since the marker, navigates back to that point, carries the summary forward, and advances the marker to the new compact point. The summary keeps accepted changes, decisions, constraints, and relevant follow-up while dropping temporary implementation noise.

### `/end` modes

- `/end` — use the extension's completed-work summary guidance
- `/end git` — also capture the commit that should be made
- `/end full` — use Pi's normal branch-summary prompt
- `/end <guidance>` — add a custom focus, for example `/end focus on API changes and migration notes`

The marker is stored in the session branch and restored when you return to it. Existing labels are preserved if the checkpoint already has one.

## Local development

```bash
bun install
bun run check
bun run pack:dry
pi -e ./index.ts
```
