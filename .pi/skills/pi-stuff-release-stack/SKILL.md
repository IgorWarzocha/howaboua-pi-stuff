---
name: pi-stuff-release-stack
description: "This repo's JJ-first stack addendum. Read after general delivery and stack guidance for dependent release work with a cumulative umbrella."
---

Before stack work, discover and load applicable repository-delivery and stack skills.

This repo's release stack has focused native PRs rooted on a staging branch plus one ordinary umbrella PR to `main`. The umbrella is cumulative and is the only PR merged to `main`.

JJ owns local revisions, order, conflicts, bookmarks, and workspaces. Use `gh stack link` and `merge` only for remote topology and assembly. Do not mix JJ-linked stacks with local `gh stack init`, `add`, `sync`, `rebase`, `push`, or `submit`.

Read the phase reference before acting:

- Create or link focused layers and open the umbrella: `references/create.md`
- Edit, push, or restructure: `references/work.md`
- Review focused layers and umbrella: `references/review.md`
- Assemble or merge after explicit approval: `references/merge.md`
