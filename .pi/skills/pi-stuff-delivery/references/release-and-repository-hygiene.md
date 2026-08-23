Add a changeset only when a package change is intended to alter published behavior or payload. Documentation, tests, ignored build output, and repository plumbing do not need one merely because they live under `packages/*`.

The patch helper compares tracked paths with `origin/main`. Stage a newly added package tree before running `bun changeset -- "summary"` so the package is discoverable, then inspect the staged result normally.

Do not hand-author aggregate changesets. When deleting a bundled package, do not invent a changeset for the absent package either. `bun run changeset:aggregates` reads deleted manifests from the comparison base and releases affected bundles.

Run a package's direct check while edits are uncommitted. After the implementation and changeset are committed, run `bun run check:changed` and `bun run changeset:check` against the branch diff. Run the umbrella gate once after a dependent batch converges.

Keep only changesets for package changes still present on the branch. Remove a changeset already consumed by an `origin/main` release commit.
