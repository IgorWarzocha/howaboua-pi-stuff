This repo publishes with Changesets. Do not write "upcoming release", "unreleased", or speculative future release notes.

Agent-facing text is behavior: tool/command names, descriptions, schemas, skill files, `promptSnippet`, `promptGuidelines`, and subagent prompts. Keep it token-efficient and non-verbose.

Skills and extensions must be universal for any user; do not ship hardcoded local paths, personal names, machine-specific assumptions, or private workflow details.

Slash commands are for users, not agents; agents use tools. For extensions with commands, default to one entry command that opens UI or routes subactions (for example `/foo` plus `/foo bar` handling) unless the user explicitly asks for multiple command names.

Installed extensions have real users. Treat related package work from one session as one release unit: consolidate it into one branch and PR before merging; do not create serial PRs for iterative fixes, tests, cleanup, or discoveries from that session. Every `main` merge feeds an npm release users must absorb.

When a change is meant to ship, add a changeset for the package(s). On merge to `main`, the version PR and publish workflow turn that into the next concrete version immediately.

Before opening or updating a PR from long-lived `dev` to `main`, fetch/prune, reset `dev` onto `origin/main`, and cherry-pick only the intended pending commits. Do not merge `main` into `dev`; it leaves already-merged history in the PR.

Use concrete version language only:

- good: `0.0.1 initial release`
- good: `adds a patch changeset for @howaboua/pi-vent`
- bad: `upcoming release`
- bad: `unreleased changes`

For package work, prefer:

```bash
bun run check:changed
bun changeset
```

Do not manually bump aggregate package versions. CI derives aggregate changesets with:

```bash
bun run changeset:aggregates
```
