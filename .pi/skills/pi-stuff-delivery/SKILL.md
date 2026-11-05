---
name: pi-stuff-delivery
description: "Read after general repository delivery when preparing, updating or landing pull requests in this repository."
---

Discover and load an applicable general repository delivery skill before delivery work.

Treat issue disposition as a PR preflight. Reconcile addressed issues against the final diff: fully resolved issues need `Closes #N` in the actual PR targeting `main`; partial fixes need `Refs #N` and concrete remaining work. Carry resolved topic references into the collector or `dev` → `main` PR. Read back the GitHub PR body before landing, then verify the issues closed after merge.

Do not invent a publication gate for resolved issues. Defer closure until npm publication only when explicitly requested, record that gate in the implementation PR and close the issues after verifying publication. Automated Changesets PRs do not inherit issue references.

When Igor explicitly asks to drive a release through admin overrides, use the GitHub account he authorises, verify its identity, and merge the reviewed head with `--admin --match-head-commit`. Do not manufacture an approving review or disable repository rules. Follow the Changesets version PR through merge and npm publication verification rather than stopping at the feature PR. Keep actual failing checks and unresolved material findings visible and fix them before merging.

For package delivery, including deferred releases, read `references/release-and-repository-hygiene.md`. This repo requires release notes for intended published behaviour, not documentation or internal plumbing that merely happens to live in a package.

For a release split into topic PRs, also discover and load the repo's applicable release-umbrella skill. Related package work from one session remains one release unit.
