# Release and Repository Hygiene

Read this reference only for shipped package work, release readiness, package changelogs or versions, funding metadata, or `pi-codex-conversion` apply-patch changes.

## Package and Changesets workflow

- Workspace packages live under `packages/*` and remain separately installable.
- Release tooling is Changesets. Do not manually bump package versions for normal feature or fix work.
- Add a changeset when a change is meant to ship. Select only directly changed individual packages; patch is the normal fix/refinement bump.
- In a release stack, each shipping layer owns its changeset; the umbrella PR does not combine them. Multiple patch entries for one package coalesce into one version bump.
- Do not manually add changesets or edit versions for aggregate packages: `@howaboua/pi-skills`, `@howaboua/pi-extensions`, or `@howaboua/pi-stuff`.
- CI derives aggregate changesets with `bun run changeset:aggregates`.
- Treat pending changesets on long-lived branches as suspect. Keep only changesets for changes intentionally present in the branch; remove files already consumed by `origin/main` release commits.
- Agent-facing package text is behavior. Keep tool descriptions, schemas, skills, prompt metadata, and subagent prompts concise and machine-independent.

Normal package finish:

1. Before committing, run the changed package's direct check or other targeted validation; `bun run check:changed` evaluates the committed branch diff and cannot validate uncommitted package edits.
2. Create the individual package changeset with `bun changeset`.
3. Commit the implementation and intended changeset together.
4. Run `bun run check:changed` and `bun run changeset:check` against the committed branch diff.

Documentation or repository tooling that is not shipped in a package normally needs no changeset. Validate the actual changed surface instead.

## Release and changelog language

- A merge to `main` immediately feeds the Version Packages PR and publish workflow. Do not describe changes as “upcoming,” “unreleased,” or speculative future work.
- Use concrete factual wording such as `adds a patch changeset for @howaboua/pi-vent`.
- Do not manually edit generated aggregate package versions or changelogs.
- Never invent release history or claims unsupported by tags, package metadata, release notes, or commits.

The release workflow generates aggregate changesets, creates or updates the Version Packages PR, merges that workflow-generated PR, publishes changed packages and relevant aggregates, and removes its release branch. Do not reproduce these automation steps manually during ordinary feature work.

## Aggregate effects

A changed skill package normally also publishes `@howaboua/pi-skills` and `@howaboua/pi-stuff`. A changed extension package normally also publishes `@howaboua/pi-extensions` and `@howaboua/pi-stuff`. Report direct package changes in the PR; aggregate changesets are automated.

## Apply-patch binary boundary

Only rebuild or commit apply-patch binaries when these paths change or the user explicitly requests it:

- `packages/pi-codex-conversion/vendor/apply-patch-src/**`
- `packages/pi-codex-conversion/scripts/build-apply-patch-binary.mjs`
- `packages/pi-codex-conversion/scripts/sync-apply-patch-source.mjs`
- `packages/pi-codex-conversion/bin/apply_patch`
- `packages/pi-codex-conversion/bin/apply_patch.cmd`
- `packages/pi-codex-conversion/src/tools/apply-patch-binary.ts`

For ordinary TypeScript changes in `pi-codex-conversion`, reuse the existing bundled binaries.

## Funding metadata

When release readiness, repository hygiene, or funding metadata is in scope, check `.github/FUNDING.yml`.

- Do not guess a service or handle.
- Keep sponsor checks internal when successful: do not include them in PR bodies or final summaries.
- Report only a missing or actionable funding problem.
