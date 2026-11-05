# Deferred release notes

Keep changesets here when a package change can wait for its next release. These notes do not trigger publication on their own. Use the normal Changesets format with one package per file.

`bun changeset -- --pending "summary"` creates pending patch notes for changed packages. `bun changeset -- "summary"` creates active patch notes. Both skip packages already covered by notes added or updated in the current diff against `origin/main`, or `CHANGED_BASE` when set.

Notes inherited unchanged from the base do not cover new work. The default command creates an active note for a new change even when that package has older pending notes. With `--pending`, the new summary is appended to the existing pending note instead. The pre-push check also requires a note added or updated in the branch diff.

When a package next releases, `bun run changeset:aggregates` merges its pending notes into one active changeset before generating bundle notes. This also runs during `bun run version-packages`. Dependency-triggered releases count. The highest bump wins and all distinct summaries are preserved.

To release a deferred change sooner, move its file into `.changeset`. Use `bun changeset:raw` to add a new active change to an already-covered package or to choose a minor or major bump. Run `bun run changeset:aggregates` before inspecting the full release plan with `bun changeset:raw status`. Direct raw versioning bypasses pending-note preparation.
