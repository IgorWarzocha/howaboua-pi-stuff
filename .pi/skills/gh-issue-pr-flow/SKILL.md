---
name: gh-issue-pr-flow
description: "This repo's GitHub/Changesets workflow: issues, parallel Herdr/worktree batches, branches, commits, PRs, review, release hygiene. Use for filing or implementing issues, package changes, PR delivery, or feedback."
---

# GitHub Issue and PR Flow

## Operating rules

- Explicit user direction and `AGENTS.md` take precedence.
- Use `gh` for GitHub operations.
- Read the relevant issue, PR, comments, reviews, repository instructions, and current implementation before acting.
- Inspect the working tree, current branch, upstream, `origin/main`, and intended PR base before branch or history operations.
- Keep unrelated local changes out of the work. Proceed around them when safe; ask only when they block the requested result.
- Infer ordinary workflow details. Ask only when ambiguity would change scope, target a surprising base, rewrite shared history, or produce an unintended external result.
- Treat implied workflow actions as authorized: “open a PR” includes focused branch creation, commit, push, and PR creation; “update this PR” includes committing and pushing in-scope fixes.
- Do not create unrelated GitHub side effects. Filing an issue does not authorize implementation.
- Never use plain `--force`. Use `--force-with-lease` only for a branch whose rewrite is clearly intended and safe.

## Contributor identity and ownership

Before the first commit or push, verify `gh api user --jq .login`, `git config user.name`, and `git config user.email`. Do not silently switch accounts or attribute collaborator work to the repository owner.

- If the checkout's branch or dirty state belongs to another task, create a dedicated worktree and focused branch from fetched `origin/main`.
- A collaborator with push permission uses a focused branch on `origin` and opens the PR as themself. Use a fork only when the repository does not grant branch push access.
- Preserve imported authorship: cherry-pick supplied commits where possible; otherwise retain their author metadata. New integration, repair, release, and documentation commits use the active contributor identity.
- The PR author may update but not approve their own work. Surface known product choices under `Review focus`; an eligible maintainer owns approval and explicit merge direction.
- If protection requires another identity, report the boundary rather than switching accounts to bypass it.

## Route the request

### File or update an issue

1. Turn the request into a concrete title, context, scope, and completion conditions.
2. Check templates and likely duplicates when useful.
3. Apply labels, projects, milestones, or assignees only when repository policy or the user establishes them.
4. Create or update the issue, return its link, and stop unless implementation was also requested.

### Implement work and open a PR

1. Establish a clean focused branch from fetched `origin/main`, unless the current branch is already dedicated to the work.
2. Implement only the agreed scope and run validation chosen from the changed surface.
3. Before final submission, apply the verification cull below to every added or changed test.
4. For shipped package work, read `references/release-and-repository-hygiene.md` before finalizing release artifacts.
5. Review the diff and branch history, stage only intended files, and commit the completed result.
6. Push and open the PR against `main`; return the link.

### Dispatch a parallel issue batch

Use a native stack as one release-batch PR set: each bounded issue gets a focused layer PR, while the top batch PR is the single requested merge action into `main`. Issues need not depend on each other when they deliberately ship together. This repo runs PR CI for every layer and Changesets/npm release work only on `push` to `main`; directly merging the top lands the stack atomically. A merge queue may split that landing, so use one integration PR instead when one release run is mandatory and direct merge is unavailable.

Dispatch is a handoff, not a supervision loop:

1. Read every issue first. Keep all issues in the requested release batch, identify dependencies and overlapping files/packages, then choose a stable bottom-to-top order. Exclude only work that should release separately.
2. Fetch `origin/main` once and record its SHA. In a dedicated coordinator worktree at that base, run `gh stack init --base main <issue-branch-1> <issue-branch-2> ...` to create and track every worker branch in stack order before implementation starts. Do not create sibling branches and retrofit them later.
3. Detach the coordinator worktree to free the stack's current branch. Check out each tracked stack branch into its own worker worktree under a sibling root such as `<repo-parent>/.worktrees/<repo>/issue-123`.
4. Require `HERDR_ENV=1` before controlling panels. Create one unfocused Herdr workspace per worktree, label it with the issue number and short title, and launch a named Pi session with `--model openai-codex/gpt-5.6-luna:high`. Parse workspace and pane IDs from Herdr's JSON; do not guess IDs.
5. Give each worker this ownership contract: read the issue and repository instructions; implement only that issue directly on the assigned stack branch; add its changeset for shipped package work; run focused validation; cull weak tests; commit all intended work; do not push, open a PR, run the umbrella gate, invoke `gh stack`, or touch another worktree. If blocked, ask in this panel and wait for the user. When finished, report commit SHA, changed surface, checks, and risks, then remain idle.
6. Return the issue → branch → worktree → Herdr workspace/pane map and stop. Do not wait for, read, message, steer, review, or decide readiness for dispatched agents. Resume only after an explicit user signal such as “workers X, Y, Z are ready.”

### Resume a dispatched issue batch

1. Treat the user's readiness signal—not panel status—as the phase gate. Inspect only the named ready worktrees and commits. Report dirty, missing, or conflicting results instead of silently completing worker tasks.
2. Stop the ready panels and detach or remove their clean worktrees so Git can rewrite the checked-out branches. In the coordinator worktree, check out a stack branch, run the cascading `gh stack rebase`, resolve integration conflicts in the owning layer, and verify the complete order with `gh stack view --json`.
3. From the top worker branch, run `gh stack add <batch-release-branch>`. This top branch is the single batch merge target; use an empty commit when it has no integration change. Verify each shipped package layer owns its changeset, then apply the verification cull across the complete stack and run the umbrella gate once from the release layer.
4. Run `gh stack submit --auto --open` to create native PRs and the stack object on GitHub.com. Verify the GitHub stack map, then edit every PR's title, body, issue linkage, base, and order. Use `Closes` only where the layer fully resolves its issue. Invoke configured review systems on each focused layer.
5. Return the layer → PR map and stop again. Dispatch review-fix workers only when the user asks; each fix wave follows the same launch-and-handoff boundary. After the user declares review converged, rebase and push the affected upstack, run `gh stack submit --auto --open`, and report readiness.
6. Merge only on explicit user direction. Confirm every layer is approved and green and the target does not require a merge queue, then directly merge the top with `gh stack merge <top-pr> --yes` and the repository's merge method. Verify the atomic `main` landing and release workflow; until one live batch confirms event behavior, do not claim the one-run release property as measured fact.

Use one integration PR instead when slices do not merit separate review, stack support is unavailable, or merge-queue behavior would defeat the single release landing. Use ordinary separate PRs when work should release independently.

### Open or update a PR for existing work

1. Inspect the intended diff, commit history, base, and any existing PR.
2. Repair stale or mixed history before presenting it. Do not launder already-merged commits into a new PR.
3. Revalidate the changed surface, apply the verification cull to test changes, then push and create or update the PR.
4. Update the body when scope, validation, issue linkage, risk, or follow-up information changed materially.

### Handle review feedback

1. Read all feedback and current code; verify each finding against the PR goal and repository rules.
2. Fix required findings unless factually wrong or out of scope. Apply recommended findings when clearly beneficial and in scope.
3. Avoid optional churn. Ask when a suggestion would materially change product behavior or agreed scope.
4. Revalidate, recull any test changes, commit, push, and summarize what was fixed, rejected, or deferred and why.

## Branch and history hygiene

- Fetch/prune before choosing a base or repairing history.
- Before using long-lived `dev` for a PR, reset it onto `origin/main` and cherry-pick only intended pending commits. Never merge `main` into `dev`.
- Do not stash, reset, overwrite, or include unrelated local changes merely for convenience.
- Do not amend or rewrite published shared history. If a push is rejected, inspect divergence before choosing rebase, reset, merge, or lease-protected force push.

## Verification cull

Before final PR submission or update, inspect every added or changed test with deletion as the default for weak evidence. Green output and increased coverage do not justify keeping a test.

Keep a permanent test only when it catches a plausible future defect that existing tests or cheaper checks miss, uses an oracle independent of the implementation, and asserts stable observable behavior. For a bug regression, demonstrate fail-before/pass-after when practical. Be able to name the unique failure mode protected by each retained test.

Feature existence is not a failure mode. Delete tests whose only claim is that a feature, fallback, retry, timeout, UI path, or bug fix currently works; calling one a regression test grants no exemption. Verify the change once, then keep only the smallest contract spine—external protocol parsing/serialization, hazardous routing/isolation, persisted-data migration, or model-visible construction—when each case independently clears the gate.

Cull literal or ordinary-copy locks, patch-mirroring expectations, near-duplicates, datatype-derived edge-case confetti, type-system guarantees, weak assertions that merely execute lines, incidental snapshots, private structure or call choreography, tests for impossible inputs, duplicate coverage, and supposed regressions that already passed before the fix. Mock only real external boundaries; never mock the behavior under test. Prefer outcomes over call counts and order.

The cull unit is a complete test case. Do not rescue a theatre test by shaving assertions or sub-scenarios; delete the case unless what remains independently clears the gate. Report complete cases deleted separately from assertions or sub-scenarios removed. If zero complete cases were deleted, say zero; never call assertion cleanup “tests culled.”

Verification does not imply a permanent test. Use the cheapest fitting evidence: existing tests, type check, lint, build, direct invocation, browser or screenshot check, or inspection. No test survives merely because it has already been written.

## GitHub writing

- Write issue and PR bodies for the next human: goal, material context, actual change, validation, and unresolved risk without routine command narration.
- Begin every PR body with one plain-language sentence stating what it is trying to do, before headings or bullets. Add more opening prose only when truly needed or when multiple affected packages need separate explanation.
- Use `Closes #123` only when the PR fully resolves the issue; otherwise use `Refs #123`.
- For multiline bodies and comments, write Markdown to a temporary file and pass `--body-file`. Do not pass shell strings containing `\n`.
- Follow repository templates, removing placeholders that do not apply.
- Do not invent labels, milestones, release history, or certainty unsupported by repository evidence.

Use this concise PR body when no more specific template applies:

```markdown
This PR ...

## Summary

- ...

## Validation

- `...`

## Release

- Changeset: yes/no
- Packages: `@howaboua/...` or none
- Aggregates: generated by release automation
```

## Codex review

When opening a PR, post the standard review request unless the user says not to. Do not repost it after every update.

```text
@codex please review this PR and give me 10-20 issues if any. Categorize findings as required, recommended, or optional.
```

Post it with `--body-file`.

## Failure handling

- **`gh` is unauthenticated:** report the visible authentication or permission failure and the relevant login step.
- **Base remains unclear:** inspect remote defaults, current PR conventions, and repository instructions; ask before targeting a surprising branch.
- **Unrelated work blocks branch operations:** explain the exact collision and ask how to preserve it.
- **History repair could affect another contributor:** stop before reset, rebase, deletion, or force push.
- **Review findings conflict:** explain the evidence instead of mechanically satisfying every reviewer.

## Finish

Return links for changed GitHub artifacts. Summarize the material result, relevant validation, branch or PR state, changed packages, and changeset status. Do not report successful sponsor checks or pad the result with routine hygiene narration.
