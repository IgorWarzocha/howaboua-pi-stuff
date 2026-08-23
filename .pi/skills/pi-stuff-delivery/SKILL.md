---
name: pi-stuff-delivery
description: "This repo's delivery addendum. Read after general repository delivery for package releases, PRs, review feedback, or a dependent release batch."
---

Before delivery work, discover and load an applicable general repository-delivery skill.

For packages, read `references/release-and-repository-hygiene.md`. Changesets cover intended published behavior, not documentation or internal plumbing. CI derives aggregate package changesets.

For dependent release work, read `../pi-stuff-release-stack/SKILL.md` before creating branches, revisions, or PRs. The JJ-first stack and its umbrella are one release unit; ordinary independent PRs stay ordinary.

Before a `dev` to `main` PR, fetch and prune, reset `dev` onto `origin/main`, then cherry-pick only intended commits. Never merge `main` into `dev`.
