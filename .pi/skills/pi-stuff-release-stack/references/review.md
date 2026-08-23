# Review an umbrella stack

Review focused PRs as layers; use the umbrella for cumulative release scope, integration, and final
landing confidence. Do not duplicate line review across both surfaces.

## Establish boundaries

Record native order, every focused head/direct parent, and umbrella head:

```bash
gh api "repos/{owner}/{repo}/stacks?pull_request=<focused-pr>"
gh pr view <focused-pr> --json number,title,body,baseRefName,headRefName,headRefOid,state,reviews,statusCheckRollup
gh pr view <umbrella-pr> --json number,title,body,baseRefName,headRefName,headRefOid,isDraft,state,reviews,statusCheckRollup
```

For Git-local fallback, use `gh stack view --json`; for JJ, inspect `jj log -r
'<staging>::<umbrella>'`. Require the umbrella bookmark to point at the cumulative focused top before
assembly. A focused diff is direct parent..layer; umbrella diff is main..top. Reviewer tools do not
switch revisions for you.

## Audit with the user

Walk focused PRs in the user's order; prefer top to bottom when deciding what can be removed. For each:

1. Read its issue, PR body, comments, direct-base diff, and owning paths.
2. State goal, changed lines/files, and whether it solves the intended problem.
3. Separate required behavior from unrelated work, speculative hardening, and over-engineering.
4. Cull tests below.
5. Record verdict and owning-layer edit.

After focused review, inspect the umbrella once for cumulative conflicts, release composition,
changesets, package effects, and user-visible summary. Do not use umbrella review to relitigate every
focused line. Repair focused owners bottom to top, update the cumulative head once, then revalidate.

## Cull tests

Inspect every added or changed test with deletion as default. Follow
the repository's applicable global review and delivery guidance. Keep only a minimal independent contract spine
for plausible future faults: protocol parsing/serialization, hazardous routing/isolation, persisted
migration, or another stable boundary with an oracle independent of the implementation.

Delete feature tours, presentation/copy locks, duplicates, setting-exists cases, and tests that only
prove current behavior. A fake provider cannot prove provider-dependent semantics; mocked event buses
cannot prove integration. Remove fixtures/helpers/exports left test-only. Report complete test cases
deleted, not assertion cleanup.

## Dispatch local reviewers

Assign one focused PR per reviewer unless overlap is explicit. Supply exact head, direct parent, goal,
and narrow risks. Reviewers are read-only in parallel. In a shared JJ repository, apply accepted fixes
one owner at a time, bottom to top; update stale workspaces between writers. Review the umbrella only
as a distinct cumulative/release task after focused passes converge.

Triage findings before involving the user: reproduce plausible faults, trace product reachability,
reject impossible states, and collapse duplicates. Fix mechanical owner-layer faults. Ask only about
material product/scope choices; never dump raw review bookkeeping.

## Request bot reviews

Finalize focused titles, bodies, order, and heads, then post one configured request bottom to top.
Use the active GitHub account and the repository's applicable delivery guidance for review comments.
Do not repost after routine pushes.

After focused repairs converge and the stack is assembled, request a separate normal review on the
umbrella's final assembled head. Reply to settled threads with evidence and resolve them. Revalidate
the cumulative state once; approval and landing belong to `merge.md`.
