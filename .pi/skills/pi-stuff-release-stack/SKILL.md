---
name: pi-stuff-release-stack
description: "Read after general repository delivery when dependent package work uses a JJ-managed native stack with one cumulative umbrella."
---

Discover and load applicable general repository delivery and stacked pull request guidance before changing stack history or topology.

This repo's focused PRs form a native stack rooted on a staging branch. A separate ordinary umbrella PR shows the cumulative release against `main`; only that umbrella lands on `main`. Each shipping layer owns its direct package changeset. Aggregate package changesets and the umbrella gate belong to the cumulative release.

JJ owns revisions, order, conflicts, bookmarks, and workspaces. `gh stack link` and `merge` own remote topology and assembly. Never adopt a JJ-linked stack into local `gh-stack` tracking.

Read the matching phase reference before acting:

- Create or publish: `references/create.md`
- Edit, push, parallelize, or reorder: `references/work.md`
- Review: `references/review.md`
- Assemble or land: `references/merge.md`
