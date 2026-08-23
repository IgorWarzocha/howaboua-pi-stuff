# Assemble and land an umbrella stack

Assembly and final landing are separate irreversible boundaries:

1. Native focused stack -> staging branch.
2. Ordinary umbrella PR -> `main`.

Each requires explicit user direction. Never infer authorization from approval, CI, or the other step.

## Focused-stack readiness

An explicit PR target selects that PR and every unmerged native member below it; a stack target selects
all unmerged members. Never broaden the boundary to satisfy a rule.

Refresh `main` before final focused approval. If staging is not at current `main@origin`, update the
base and rewrite the focused chain before treating any head/check/approval as final:

```bash
jj git fetch --remote origin
jj bookmark move <staging> --to main@origin --allow-backwards
jj rebase --source <bottom> --onto <staging>
# resolve every recorded conflict
jj bookmark move <umbrella> --to <top> --allow-backwards
jj git push --remote origin --bookmark <staging>
jj git push --remote origin --bookmark <bottom> --bookmark <next> --bookmark <top>
jj git export --ignore-working-copy
gh stack link --base <staging> <bottom> <next> <top>
jj git push --remote origin --bookmark <umbrella>
```

Rerun focused and cumulative checks/reviews on rewritten heads. For the Git fallback, fast-forward the
still-empty staging branch to `origin/main`, push it, then cascade-rebase/push the locally tracked stack
and update the umbrella. If staging cannot fast-forward because it already contains assembled work,
stop and reassess the selected release boundary instead of merging `main` into it.

Before approval/assembly:

- Native trunk is the dedicated staging branch, not `main` or umbrella.
- Every selected focused PR is open, non-draft, approved, green, and free of unresolved required
  threads.
- JJ graph or Git ancestry matches native order and contains no conflicts or unrelated changes.
- Umbrella bookmark/branch points at the selected cumulative top.
- Cumulative umbrella check passes once from that top.

For a colocated JJ route, record the candidate tree before assembly:

```bash
jj git export --ignore-working-copy
candidate_tree=$(git rev-parse '<umbrella>^{tree}')
```

The author cannot approve their own work. When an eligible reviewer is established, use that account's
token for approval only; never switch the active `gh` account:

```bash
: "${pr:?set focused PR}"
: "${reviewer:?set eligible reviewer login}"
token=$(gh auth token --user "$reviewer")
test "$(GH_TOKEN="$token" gh api user --jq .login)" = "$reviewer"
GH_TOKEN="$token" gh pr review "$pr" --approve
```

## Assemble into staging

State the boundary and method, then suppress prompts:

```bash
gh stack merge <highest-focused-pr> --yes --squash
```

Use another method only when deliberately selected. The native operation is all-or-nothing unless a
merge queue controls grouping. Never substitute serial `gh pr merge` calls. If the endpoint requires
a code owner despite valid approvals, confirm nothing merged, then retry the exact same boundary with
that code owner's token; never include an unrelated upper PR.

When a merge queue accepts the stack, queued is not assembled. Wait at a reasonable interval until
every selected focused PR reports merged and the Stacks REST response shows staging advanced; stop on
queue cancellation or failure. Only then verify `main` did not move and refresh the umbrella. For JJ:

```bash
jj git fetch --remote origin
jj bookmark move <umbrella> --to '<staging>@origin' --allow-backwards
jj git push --remote origin --bookmark <umbrella>
jj git export --ignore-working-copy
test "$(git rev-parse '<umbrella>^{tree}')" = "$candidate_tree"
```

For the Git fallback, fetch staging, force the separate umbrella branch to its tip, and push with
`--force-with-lease`; never add umbrella to local stack tracking. A tree mismatch means assembly did
not preserve the reviewed cumulative state: stop before final review.

## Final umbrella gate

The umbrella stays open and ready for visibility by default; an explicitly requested draft is the only
exception. Its head rewrite intentionally reruns aggregate CI and may dismiss old approval. After assembly,
update its body with the focused PR list, actual changesets/packages, validation, and resolved risks:

```bash
gh pr view <umbrella-pr> --json baseRefName,headRefOid,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup
```

Require base `main`, final assembled head, green aggregate checks, fresh eligible approval, and no
unresolved required threads. This is release-level review; focused line review stays on the merged
sub-PRs.

## Land on main

Only a separate explicit instruction authorizes the ordinary umbrella merge:

```bash
gh pr merge <umbrella-pr> <--squash|--merge|--rebase>
```

Use `--squash` by default in this repository; replace it only when repository policy or explicit user
direction selects another method. This is the sole operation that moves `main` and triggers release
automation. Afterward verify the umbrella merged, `main` contains the reviewed tree, focused PRs remain
recorded as merged into staging, and no open native stack member was bypassed. Clean remote/local refs
only when repository policy or the user requests it.
