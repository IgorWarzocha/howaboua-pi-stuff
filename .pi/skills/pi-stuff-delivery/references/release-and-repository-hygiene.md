Add a changeset only when a package change is intended to alter published behavior or payload. Documentation, tests, ignored build output, and repository plumbing do not need one merely because they live under `packages/*`.

Use `.changeset` for the next release and `.changesets-pending` for deliberately deferred publication. Keep deferred notes rather than deleting them or bypassing the changeset gate. Deferral does not deliver source changes to installed users. Read `.changesets-pending/README.md` for helper commands and coverage rules.

The patch helper compares tracked paths with `origin/main`. Stage a newly added package tree before running `bun changeset -- "summary"` so the package is discoverable, then inspect the staged result normally.

Do not hand-author aggregate changesets. When deleting a bundled package, do not invent a changeset for the absent package either. `bun run changeset:aggregates` reads deleted manifests from the comparison base and releases affected bundles.

Run a package's direct check while edits are uncommitted. After the implementation and changeset are committed, run `bun run check:changed` and `bun run changeset:check` against the branch diff. Run the umbrella gate once after a dependent batch converges.

Keep exactly one changeset per changed extension in a release, with one extension per file. Before inspecting the release plan, run `bun run changeset:aggregates` to fold pending notes for packages already releasing into package and bundle changelogs. Use `bun run version-packages`, not raw versioning, to preserve this preparation. Do not activate unrelated deferred packages merely to consolidate notes. Dependency-only and documentation changes still need none; aggregates remain CI-owned. Drop notes for reverted changes, but preserve inherited pending notes awaiting publication. Remove an active changeset already consumed by an `origin/main` release commit.

Write each changeset body as final user-visible changelog copy covering net changes since the last release. Use terse, literal language, and do not add a generic “Changes” heading above a list. Put a breaking change and its migration before ordinary changes. State each delta as “Added”, “Fixed”, “Removed”, or “X now does Y”. Name the changed tool, command, setting, or failure and the exact behavior. Avoid permission prose such as “let”, “allow”, or “enable”, and avoid instructions unless the user must migrate. Remove vague intent, defaults that matter only before installation, implementation detail, safeguards, and review history unless they explain a user-visible limit or recovery path. Use separate bullets for distinct changes within an extension. A new package gets an initial-release entry with core capabilities, never pre-release bug-fix history.

Judge breaking changes by practical upgrade impact, not every conceivable incompatible caller. Do not promote hypothetical saved-helper failures or rare custom-tool name collisions into breaking banners and migration instructions. For agent-facing result changes, state the old and new behaviour. Keep prominent migration guidance for actual user configuration and integration changes.

Lead with the capability delivered. Keep limitations proportionate and precise, without obscuring supported features such as custom state restoration.
