Add a changeset only when a package change is intended to alter published behavior or payload. Documentation, tests, ignored build output, and repository plumbing do not need one merely because they live under `packages/*`.

The patch helper compares tracked paths with `origin/main`. Stage a newly added package tree before running `bun changeset -- "summary"` so the package is discoverable, then inspect the staged result normally.

Do not hand-author aggregate changesets. When deleting a bundled package, do not invent a changeset for the absent package either. `bun run changeset:aggregates` reads deleted manifests from the comparison base and releases affected bundles.

Run a package's direct check while edits are uncommitted. After the implementation and changeset are committed, run `bun run check:changed` and `bun run changeset:check` against the branch diff. Run the umbrella gate once after a dependent batch converges.

Keep only changesets for package changes still present on the branch. Remove a changeset already consumed by an `origin/main` release commit.

Write each changeset body as final user-visible changelog copy. Use terse, literal language, and do not add a generic “Changes” heading above a list. Put a breaking change and its migration before ordinary changes. State each delta as “Added”, “Fixed”, “Removed”, or “X now does Y”. Name the changed tool, command, setting, or failure and the exact behavior. Avoid permission prose such as “let”, “allow”, or “enable”, and avoid instructions unless the user must migrate. Remove vague intent, defaults that matter only before installation, implementation detail, safeguards, and review history unless they explain a user-visible limit or recovery path. Keep unrelated changes in separate changesets. A new package gets an initial-release entry with core capabilities, never pre-release bug-fix history.
