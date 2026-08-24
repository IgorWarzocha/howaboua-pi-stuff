Treat native-stack assembly into staging and umbrella landing on `main` as separate irreversible actions. Each needs explicit user direction.

## Refresh the release base

Before final focused approval, move staging to current `main@origin` and rebase the focused chain:

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

Recheck focused diffs, direct changesets, native order, and the cumulative umbrella after rewritten heads. Require selected focused PRs to be open, ready, green, approved by an eligible reviewer, and free of unresolved required threads.

Record the reviewed cumulative tree before assembly:

```bash
jj git export --ignore-working-copy
candidate_tree=$(git rev-parse '<umbrella>^{tree}')
```

## Assemble into staging

State the selected boundary, then use the native atomic operation:

```bash
gh stack merge <highest-focused-pr> --yes --squash
```

Do not substitute serial `gh pr merge` calls. If a merge queue accepts the stack, queued is not assembled. Wait until every selected focused PR is merged and the remote stack shows staging advanced.

Refresh JJ and move the ordinary umbrella to the assembled staging result:

```bash
jj git fetch --remote origin
jj bookmark move <umbrella> --to '<staging>@origin' --allow-backwards
jj git push --remote origin --bookmark <umbrella>
jj git export --ignore-working-copy
test "$(git rev-parse '<umbrella>^{tree}')" = "$candidate_tree"
```

A tree mismatch means assembly did not preserve the reviewed release. Stop before final review.

## Land the umbrella

Update the umbrella body with the merged focused PRs, direct package changesets, aggregate release effects, and actual cumulative validation. Require base `main`, the final assembled head, green aggregate checks, fresh eligible approval, and no unresolved required threads.

Only a separate explicit instruction authorizes:

```bash
gh pr merge <umbrella-pr> --squash
```

Verify the umbrella merged to `main` and contains the reviewed tree. Clean staging, umbrella, focused refs, and JJ workspaces only when requested or when repository policy requires it.
