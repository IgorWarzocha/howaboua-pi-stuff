# AGENTS.md

This repo publishes with Changesets. Do not write "upcoming release", "unreleased", or speculative future release notes.

Agent-facing text is behavior: tool/command names, descriptions, schemas, skill files, `promptSnippet`, `promptGuidelines`, and subagent prompts. Keep it token-efficient and non-verbose.

When a change is meant to ship, add a changeset for the package(s). On merge to `main`, the version PR and publish workflow turn that into the next concrete version immediately.

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
