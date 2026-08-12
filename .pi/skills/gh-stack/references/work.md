# Work with a stack

Use this phase for inspection, changes to an existing layer, cascading rebases, pushes, and topology
repair. Use `review.md` for human, agent, or bot review passes.

## Establish current state

For read-only inspection:

```bash
gh stack view --json
```

Before changing a stacked branch, PR, base, or history:

```bash
gh stack sync
# Treat "Sync aborted" as failure even when exit status is 0.
gh stack view --json
```

`sync` fetches, reconciles GitHub membership, fast-forwards trunk, cascade-rebases when needed,
atomically pushes active branches, refreshes PRs, and updates the stack object. It does not create PRs.
If the target is absent or local and remote topology diverged, stop before rewriting.

## Edit a layer

```bash
gh stack checkout <owning-pr-or-branch>
# edit, validate, stage deliberately, commit
gh stack rebase --upstack
gh stack top
gh stack push
gh stack view --json
```

`push` updates every active branch with per-branch force-with-lease and never updates PR metadata. It
is not atomic: repair a rejected branch and rerun. Use `submit --auto --open` when PR creation or stack
linkage also needs repair.

Navigation commands `up`, `down`, `top`, `bottom`, and `trunk` are noninteractive. `checkout` accepts a
stack number, PR number or URL, or locally tracked branch. A bare number resolves as stack first, then
PR. Use a PR or stack number to fetch untracked remote state.

## Rebase recovery

`sync` restores all branches after a rebase conflict and exits 3. Recreate the conflict with `rebase`,
resolve and stage it, then continue:

```bash
gh stack rebase
git add <resolved-paths>
gh stack rebase --continue
```

Repeat as needed. `gh stack rebase --abort` restores the entire stack. `--upstack` starts at the
current branch; `--downstack` ends there; `--no-trunk` aligns stack branches without rebasing trunk.
Starting while another rebase is active exits 7.

## Divergence and restructuring

When `sync` reports different local and GitHub chains, choose one authority deliberately:

```bash
# Keep remote composition
gh stack unstack --local
gh stack checkout <stack-or-pr>

# Keep verified local ancestry
gh stack unstack
gh stack init --base main <bottom> <next> <top>
gh stack submit --auto --open
```

`unstack` removes grouping, never branches or PRs. There is no noninteractive reorder or removal.
For a structural change, record boundary SHAs, rewrite Git ancestry bottom to top, unstack, then rebuild
with `init`; changing PR bases or metadata alone does not move commits.

If a branch belongs to several stacks, commands may exit 6. Check out a branch unique to the intended
stack or use an explicit stack number. A stale stack lock exits 8; wait for the owning process. An
interrupted TUI modify exits 10 and may be cleared with `gh stack modify --abort`, but never start a
new modify session noninteractively.
