# Create a stack

Use this phase to choose layers, establish the chain, and create the native PR stack before parallel
or dependent implementation begins.

## Choose the landing shape

Use a stack when concerns merit focused PRs but deliberately land together: code dependencies or a
repository-defined issue/release batch. Use one ordinary PR when slices do not merit separate review.
Use separate PRs or stacks when work should release independently. Use an integration PR instead when
a merge queue would split an atomic release or direct native stack merge is unavailable.

Plan bottom to top before writing code. Dependencies go in the same or a lower layer. Give each layer
one sentence of ownership and use repository branch conventions; otherwise prefer
`<topic>/<concern>`. Reserve a top cap only for real integration or release work, not as a dumping
ground.

## Preconditions

```bash
gh stack --version
git config rerere.enabled true
gh api user --jq .login
git config user.name
git config user.email
git status --short --branch
git fetch --prune origin
```

Inspect existing branches and PRs before adopting them. With several remotes, pass `--remote` where
supported or configure one unambiguous remote.

## Create the chain

Create all planned branches upfront for a parallel issue batch:

```bash
gh stack init --base main <bottom> <next> <top>
```

Arguments are bottom to top; existing branches are adopted, missing branches are created, and the
last branch is checked out. For sequential implementation, create the bottom and add layers from the
current top:

```bash
gh stack init --base main <bottom>
# edit, validate, stage deliberately, commit
gh stack add <next>
```

`add` carries uncommitted changes onto the new branch. Avoid its commit shortcuts: use `git add` and
`git commit` directly so each layer owns only its concern. `add` from a middle branch exits 5; move to
the top first.

For branches owned by another manager or worktree layout, link without creating local tracking:

```bash
gh stack link --base main <bottom-branch-or-pr> <next> <top>
```

`link` is additive, accepts branches or PRs bottom to top, may push branch arguments and create or
retarget PRs, and never removes members. Use `gh stack checkout <stack-or-pr>` later if local tracking
is needed.

## Submit

From the top after every layer is committed and the complete stack validates:

```bash
gh stack submit --auto --open
gh stack view --json
```

Omit `--open` only when drafts were explicitly requested. Submit pushes active branches, creates or
updates PRs, bases each on its active ancestor, and links the GitHub stack. It is not atomic: earlier
pushes and PR changes survive a later failure, so repair the rejected branch and rerun. Exit 9 means
stacked PRs are unavailable.

`--auto` derives titles from commits or branch names. Use `gh pr edit` afterward for accurate title,
body, issue linkage, validation, and release information. Verify the GitHub stack order rather than
inferring it from ancestry alone.
