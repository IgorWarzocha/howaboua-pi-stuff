---
name: pi-stuff-release-umbrella
description: "Read after general repository delivery when one release uses a parent collector PR and focused topic PRs."
---

Discover and load applicable general repository delivery guidance. For this repo's umbrella releases, use a parent collector with topic PRs targeting its branch, not a native linear stack with a separate cumulative copy.

Independent topics are siblings. Use a dependent sub-stack only for demonstrated dependencies. Each topic owns its coherent commit range, review fixes and direct package changeset. Only the collector targets `main`, so installed users receive one release.

The collector contains repo guidance and already-merged topics. Keep unmerged topic payload out of it or child diffs become empty. A private JJ sibling-merge preview contains the cumulative candidate for validation, never a published replacement collector.

JJ owns history, conflicts and bookmarks. Keep one writer for collector and remote topology. Native stack membership is not required for siblings.

Read the matching phase reference:

- Create or publish: `references/create.md`
- Edit or correct topology: `references/work.md`
- Review: `references/review.md`
- Collect or land: `references/merge.md`
