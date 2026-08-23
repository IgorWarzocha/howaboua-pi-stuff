Use one ordinary PR when slices do not need separate review. Use this stack only when dependent package layers must remain one release unit.

Keep four ref roles:

```text
<batch>/staging        native-stack trunk; no PR
<topic>/<layer>        focused PR bookmarks, bottom to top
<batch>/umbrella       ordinary cumulative PR; never a stack member
main                   only release target
```

## Establish the base

Verify the active contributor and both CLIs before creating refs:

```bash
gh stack --version
gh api user --jq .login
jj --version
jj root
jj status
jj workspace list
jj config get user.name
jj config get user.email
jj git fetch --remote origin
```

Use an existing colocated JJ repository or a dedicated `jj git clone --colocate`. Do not retrofit JJ into a shared Git checkout or worktree.

```bash
jj bookmark create <staging> --revision main@origin
jj git push --remote origin --bookmark <staging>
```

## Build focused layers

Create each dependent revision from its stable parent. Keep its implementation, direct package changeset, and focused validation together.

```bash
jj new <staging> -m "<bottom description>"
# edit, validate, add the direct package changeset
jj bookmark create <bottom> --revision @

jj new -m "<next description>"
# edit, validate, add the direct package changeset
jj bookmark create <next> --revision @
```

Do not publish empty planning revisions. Before publication, require every focused revision to be described, conflict-free, non-empty, and limited to its layer.

## Publish the two GitHub surfaces

`gh stack link` reads exported Git refs and only performs a non-force push. Push rewritten bookmarks through JJ, then force an export so the linker sees the current heads:

```bash
jj bookmark create <umbrella> --revision <top>
jj git push --remote origin --bookmark <bottom> --bookmark <next> --bookmark <top>
jj git export --ignore-working-copy
gh stack link --base <staging> --open <bottom> <next> <top>
jj git push --remote origin --bookmark <umbrella>
gh pr create --base main --head <umbrella> --title "<release title>" --body-file <body>
```

The umbrella is ready unless the user explicitly requests a draft. Each focused PR links back with `Part of #<umbrella-pr>`. Verify every focused direct base and head, the remote native order, and the `main..<umbrella>` cumulative diff.

If JJ is unavailable from the start, let local `gh-stack` own the focused chain with `init`, `add`, and `submit`. Keep the umbrella outside local stack tracking. Never switch an existing stack between the two history owners.
