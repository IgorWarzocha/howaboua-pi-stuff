---
name: repository-delivery
description: "Read before recording or delivering repository work through commits, GitHub issues, or pull requests."
last-changed: "2026-08-22"
---

Apply repository instructions as local constraints. Read the relevant request, issue, pull request, discussion, and reviews. Explicit user direction resolves genuine conflicts.

Before commit, branch, or history work, inspect the working tree, unrelated changes, current branch, upstream, remote default and target branches, and any existing pull request.

Authorization:

- Record coherent working states when useful and finish requested repository edits committed. Do not wait for a separate instruction to commit unless the user asked for uncommitted work or repository instructions require it.
- Opening a pull request authorizes its normal branch, commit, push, and creation steps.
- Updating a pull request or addressing its review authorizes committing and pushing in-scope fixes.
- Filing or updating an issue authorizes publishing that issue, not implementing it. Drafting a body alone does not authorize publishing it. Opening a pull request does not authorize requesting review or merging it.

Preserve unrelated work. Proceed around it when safe. Ask only when it blocks the requested result.

When multiple accounts or contributors are possible, verify GitHub and commit identity before the first commit or push. Never switch accounts silently, misattribute work, approve your own pull request, or bypass protection through another identity.

Read only the needed branch:

- Issue creation or update: `references/issues.md`
- Pull request creation, update, review, stacking, or landing: `references/pull-requests.md`

## Commits

1. Stage deliberately and inspect the staged diff. Exclude unrelated edits, temporary diagnostics, local artifacts, and another task's work.
2. Make each commit one coherent, inspectable state. Split when states can be understood, accepted, reordered, or reverted independently, when a stack needs layers, or when comparison and rollback are useful. Do not split by file count or elapsed time. Keep directly supporting tests, docs, migrations, and generated artifacts together.
3. Write the subject from the staged effect with concrete domain nouns and an active verb. Follow repository grammar and prefixes. Avoid vague subjects such as `Fix bug`, `Update files`, `Changes`, or `WIP`, plus branch names and ticket numbers alone.
4. Add a body only for reasons, prior behavior, constraints, trade-offs, compatibility, migrations, or deliberate limitations not clear from the subject and diff. Do not narrate files, commands, session history, or agent involvement. Follow established signing and trailer conventions. Preserve verified authorship. Never invent attribution.
5. Do not keep a pull request as one repeatedly amended commit. Amend only a small immediate correction that completes the same commit when the earlier state has no diagnostic or review value. Use a new commit for a materially different state, alternative approach, later behavior fix, or review fix worth comparing. Preserve useful states until testing and review converge. Let merge policy squash them. Never rewrite published shared commits.
