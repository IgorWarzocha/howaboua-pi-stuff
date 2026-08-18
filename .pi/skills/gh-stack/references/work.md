# Work with an umbrella stack

Keep one local-history owner. Determine whether the stack is JJ-linked or locally tracked by
`gh-stack` before changing commits, refs, PR bases, or native topology.

## Inspect a JJ-linked stack

```bash
jj git fetch --remote origin
jj status
jj workspace list
jj log -r '<staging>::<umbrella>'
gh api "repos/{owner}/{repo}/stacks?pull_request=<focused-pr>"
gh pr view <umbrella-pr> --json baseRefName,headRefName,headRefOid,isDraft,state,statusCheckRollup
```

The Stacks REST array must contain exactly one matching stack. Inspect each focused PR as needed.
Treat native membership/order and JJ's graph as separate facts; both must match the intended plan.
Stop on conflicted bookmarks, unexpected remote movement, or a workspace owned by another task.

## Edit a JJ layer

```bash
jj edit <owning-layer>
# edit and validate
jj describe -m "<accurate layer description>"
jj status
```

JJ automatically rebases descendants when an ancestor is rewritten. Inspect every descendant and
resolve recorded conflicts before publishing; never push conflict-bearing revisions. Move the
umbrella explicitly to the current focused top when needed:

```bash
jj bookmark move <umbrella> --to <top> --allow-backwards
jj git push --remote origin --bookmark <bottom> --bookmark <next> --bookmark <top>
jj git export --ignore-working-copy
gh stack link --base <staging> <bottom> <next> <top>
jj git push --remote origin --bookmark <umbrella>
```

Push rewritten focused bookmarks through JJ first because `link` only performs a non-force Git push.
JJ workspaces can also leave the coordinator's colocated Git refs stale; forced export makes `link`
see current bookmarks. `jj git push` uses remote-state safety equivalent to force-with-lease. Fetch
and inspect bookmark conflicts rather than bypassing a rejected update. Rerun `link` with the complete
focused order when heads or PR bases changed. Never include staging or umbrella in the list.

## Parallel JJ workspaces

JJ workspaces share one operation log. Concurrent writers must own sibling revisions from a stable
base, never revisions already arranged as ancestors and descendants:

```bash
jj workspace add <path> --name <worker> --revision <stable-base> -m "<layer description>"
# the new workspace's @ is the worker-owned candidate revision
```

Workers edit only their candidate `@`; they do not push, create/move bookmarks, link, reorder, or move
the umbrella. Dispatch only independent candidates concurrently. After readiness, the coordinator
integrates accepted candidates bottom-to-top, compares each workspace's effective lockfile with its stable
parent, and validates the cumulative result before starting a child from its stable parent. Use Bun's shared
download cache. Run frozen install/linking locally against each workspace's effective lockfile; never share,
symlink, or copy `node_modules` trees across workspaces. Update stale workspaces before each new dispatch
wave.

Once revisions are linearly stacked, allow only one writer at a time. Parallel review may stay
read-only; apply accepted fixes bottom to top, waiting for each rewrite and descendant rebase to settle
before starting the next workspace. Run `jj workspace update-stale` before each handoff. Concurrently
rewriting stacked layers creates divergent versions of every rebased descendant and conflicted
bookmarks; do not treat later bookmark repair as the normal integration path.

When a workspace is no longer needed, delete its directory only after its intended change is safely
bookmarked, then run `jj workspace forget <worker>`. A workspace path is not a Git worktree; do not
manage it with `git worktree`.

## Restructure a JJ-linked stack

Use `jj rebase --revisions`, `--insert-after`, or `--insert-before` to change local order, then inspect
the exact graph and cumulative tree. `gh stack link` is additive and cannot remove or reorder existing
remote members. For a real topology change:

1. Record stack number, PR numbers, heads, bases, staging, and umbrella SHA.
2. Rewrite and verify the JJ graph.
3. `gh stack unstack <stack-number>` to remove only native grouping; keep branches and PRs.
4. Relink the complete focused order with `gh stack link --base <staging> ...`.
5. Verify every focused base, native order, and umbrella cumulative diff.

Do not fake restructuring by changing PR bases alone; commits and JJ bookmarks must agree first.

## Git-managed fallback

For a stack created with local `gh-stack` tracking:

```bash
gh stack sync
# Treat "Sync aborted" as failure even when exit status is 0.
gh stack checkout <owning-pr-or-branch>
# edit, validate, stage, commit
gh stack rebase --upstack
gh stack top
gh stack push
git branch --force <umbrella> HEAD
git push --force-with-lease origin <umbrella>
gh stack view --json
```

On rebase conflict, run `gh stack rebase`, resolve and stage, then `gh stack rebase --continue`; abort
restores the stack. Use the existing `gh-stack` divergence controls. Never introduce JJ midway through
a locally tracked stack.
