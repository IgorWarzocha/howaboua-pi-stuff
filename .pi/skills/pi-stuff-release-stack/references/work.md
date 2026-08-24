Determine whether JJ or local `gh-stack` owns history before changing revisions, refs, PR bases, or remote topology.

## Inspect a JJ-linked stack

```bash
jj git fetch --remote origin
jj status
jj workspace list
jj log -r '<staging>::<umbrella>'
gh api "repos/{owner}/{repo}/stacks?pull_request=<focused-pr>"
gh pr view <umbrella-pr> --json baseRefName,headRefName,headRefOid,isDraft,state,statusCheckRollup
```

The REST response is authoritative for native membership and order. JJ's graph is authoritative for local history. Stop on conflicted bookmarks, unexpected remote movement, or another task's workspace.

## Edit and publish a layer

```bash
jj edit <owning-layer>
# edit and validate
jj describe -m "<accurate layer description>"
jj status
jj bookmark move <umbrella> --to <top> --allow-backwards
jj git push --remote origin --bookmark <bottom> --bookmark <next> --bookmark <top>
jj git export --ignore-working-copy
gh stack link --base <staging> <bottom> <next> <top>
jj git push --remote origin --bookmark <umbrella>
```

JJ rebases descendants after an ancestor rewrite. Inspect and resolve every descendant conflict before publishing. Fetch and resolve bookmark divergence rather than bypassing JJ's remote-state safety.

Always pass the complete focused order to `link` after heads or bases change. Never include staging or umbrella. `link` is additive: it cannot remove or reorder existing remote members. For a topology change, record the stack and PR heads, rewrite the JJ graph, run `gh stack unstack <stack-number>`, then relink the complete order and verify it. If queued or auto-merge members remain stacked, stop rather than creating mixed topology.

## Parallel JJ workspaces

Concurrent writers must own sibling candidate revisions from one stable base, never already-stacked ancestors and descendants:

```bash
jj workspace add <path> --name <worker> --revision <stable-base> -m "<layer description>"
```

Workers edit only their candidate `@`. They do not push, move bookmarks, link, reorder, or move the umbrella. After a wave, integrate accepted candidates bottom to top and run `jj workspace update-stale` before each handoff.

Each workspace uses its effective lockfile and Bun's shared download cache. Run frozen install or linking inside that workspace. Never share, symlink, or copy `node_modules` between workspaces. Once revisions become linear, allow only one writer.

Delete a workspace directory only after its change is safely bookmarked, then run `jj workspace forget <worker>`. A JJ workspace is not a Git worktree.

For a stack already owned by local `gh-stack`, use its `sync`, `checkout`, `rebase --upstack`, and `push` flow. Treat `Sync aborted` as failure even if the process exits zero. Never introduce JJ midway.
