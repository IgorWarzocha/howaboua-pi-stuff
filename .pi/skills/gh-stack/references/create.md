# Create an umbrella stack

Plan one cumulative ordinary PR plus focused native stack layers. Use one ordinary PR instead when
the slices do not merit separate review; use separate release units when work may ship independently.

## Plan bottom to top

Name four kinds of ref:

```text
<batch>/staging        remote native-stack trunk; no PR
<topic>/<layer>        one bookmark/branch per focused PR
<batch>/umbrella       ordinary umbrella PR head; never a stack member
main                   umbrella PR base; only release target
```

Dependencies belong in the same or a lower focused layer. Give each layer one ownership sentence.
The umbrella owns only cumulative release context, not implementation or a fake cap change.

## Preconditions

```bash
gh stack --version
gh api user --jq .login
git config user.name
git config user.email
git status --short --branch
```

For JJ, also verify `jj --version`, `jj root`, `jj status`, `jj workspace list`, `jj config get
user.name`, and `jj config get user.email`. JJ identity is separate from Git identity; configure the
verified active contributor before creating changes. Use an existing colocated JJ repository or a
dedicated `jj git clone --colocate`; do not retrofit JJ into a shared checkout/worktree. Run `jj git
fetch --remote origin` before selecting `main@origin`.

Inspect existing PRs, bookmarks/branches, and remote names before creating refs. Configure an explicit
remote when more than one is plausible.

## Preferred JJ route

Create and publish a staging bookmark at the selected `main` revision:

```bash
jj bookmark create <staging> --revision main@origin
jj git push --remote origin --bookmark <staging>
```

Create focused changes bottom to top. A bookmark points to each completed change; `@` advances to the
next layer:

```bash
jj new <staging> -m "<bottom description>"
# edit and validate the bottom layer
jj bookmark create <bottom> --revision @

jj new -m "<next description>"
# edit and validate the next layer
jj bookmark create <next> --revision @
```

For a parallel batch, give writable workers sibling revisions from the stable staging revision, not a
prebuilt ancestor/descendant chain. Dispatch only independent candidates concurrently. After a wave's
accepted candidates are ready, integrate them bottom to top, compare each workspace's effective lockfile
with its stable parent, and update stale workspaces before creating the next wave from stable parents. Use
Bun's shared download cache. Run frozen install/linking locally against each workspace's effective lockfile;
never share, symlink, or copy `node_modules` trees across workspaces. Repeat until every dependent layer is
ready.
Move the coordinator working copy away before workers edit:

```bash
jj new <staging>
```

Create worker workspaces as specified in `work.md`. Empty candidate revisions are local planning state
only; do not link or push them.

Before publishing, require every focused revision to be non-empty, described, conflict-free, and to
own only its layer. Create the umbrella bookmark at the focused top:

```bash
jj bookmark create <umbrella> --revision <top>
```

Link only focused bookmarks, bottom to top. `link` pushes them, creates or retargets focused PRs, and
creates the native GitHub stack without local `gh-stack` tracking:

```bash
jj git push --remote origin --bookmark <bottom> --bookmark <next> --bookmark <top>
jj git export --ignore-working-copy
gh stack link --base <staging> --open <bottom> <next> <top>
jj git push --remote origin --bookmark <umbrella>
```

Open the cumulative umbrella as an ordinary PR for visibility. It is ready by default; add `--draft` only
when explicitly requested:

```bash
gh pr create --base main --head <umbrella> --title "<release title>" --body-file <body>
```

GitHub cannot open an empty PR. Create the umbrella after the first real focused change exists; never
seed it with placeholder code or metadata. Its body lists focused PRs and release-level validation.
Each focused PR links back with `Part of #<umbrella-pr>`.

## Git-managed fallback

Use only when JJ is unavailable. Create staging from the selected target, then let `gh-stack` own the
focused branch chain:

```bash
git switch --create <staging> origin/main
git push --set-upstream origin <staging>
gh stack init --base <staging> <bottom>
# edit, validate, commit
gh stack add <next>
```

After all focused layers are committed:

```bash
gh stack submit --auto --open
gh stack top
git branch <umbrella>
git push --set-upstream origin <umbrella>
# ready by default; append --draft only when explicitly requested
gh pr create --base main --head <umbrella> --title "<release title>" --body-file <body>
```

`add` carries uncommitted changes; avoid its commit shortcuts. `submit` is not atomic, so repair a
rejected branch and rerun. Keep the umbrella branch outside local stack tracking. Do not run the JJ
export command in this fallback route.

## Verify publication

Inspect each focused PR's direct base and current head, the remote native order, and the umbrella's
`main..umbrella` cumulative diff. Do not infer native membership from ancestry alone. Record focused
PR numbers, stack number, staging ref, umbrella PR, and umbrella head SHA.
