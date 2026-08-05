# Designing a stack

How to decide what goes in each layer. Read this before running `gh stack init`.

## Contents

- [Plan the layers before writing code](#plan-the-layers-before-writing-code)
- [Branch naming](#branch-naming)
- [Staging changes deliberately](#staging-changes-deliberately)
- [When to add a layer](#when-to-add-a-layer)
- [One stack, one landing unit](#one-stack-one-landing-unit)

## Plan the layers before writing code

A stack is a linear landing chain. Usually it follows code dependencies; it can also order bounded
issue PRs that repository policy deliberately ships as one release batch. If code in one layer
depends on another, the dependency must live in the same branch or a lower one. Plan before writing:
there is no noninteractive in-place reorder, so fixing the order means `unstack` and `init` again.

Decide the layers first, then write code into them:

```
(main) <- todo-app/models <- todo-app/api <- todo-app/frontend <- todo-app/integration
```

- `todo-app/models` — shared types and schema
- `todo-app/api` — routes that use the models
- `todo-app/frontend` — components that call the routes
- `todo-app/integration` — tests exercising the whole feature

This is illustrative. Infer the stack topic and layer names from the actual task; do not reuse
`todo-app` or these layer names literally.

The failure mode to avoid is writing everything on one branch and trying to split it afterwards.
If a task is large enough to warrant a stack, create the stack at the start.

## Branch naming

Prefer a shared topic prefix plus the layer's concern:
`<topic>/<concern>` — for example, `billing/schema`, `billing/api`, `billing/ui`.
This keeps related branches recognizable without using generic names that could belong to any
stack. **User and repository branch naming conventions take precedence; follow them instead.**

Names are used exactly as given — nothing is prepended or transformed, and slashes are kept, so
`gh stack add refactor/foo` creates a branch literally named `refactor/foo`.

If you pass `-m` without a branch name, the name is generated from the commit message in
date-and-slug form (for example `03-24-add_api_routes`). Prefer naming the branch yourself.

## Staging changes deliberately

Use `git add` and `git commit` directly rather than the `add -Am` shortcut. The point is control
over which changes land in which branch. With several modified files in the working tree, stage the
subset that belongs to the current layer, commit it, then create the next branch and stage the rest
there:

```bash
git add internal/models/user.go internal/models/session.go
git commit -m "Add user and session models"

gh stack add api-routes
git add internal/api/routes.go internal/api/handlers.go
git commit -m "Add user API routes"
```

Multiple commits per branch are fine. What matters is that every commit in a branch serves the same
concern, and that a change belonging to a different concern goes in a different branch.

`gh stack add <branch>` does not touch the working tree, so uncommitted changes carry over. Commit
or stash first if the new layer should start clean.

## When to add a layer

Add a branch when you start a **different concern that depends on what you have built so far**.
Signals:

- Moving from backend to frontend, or from core logic to tests or documentation
- The next changes have a different reviewer audience
- The current branch's diff is already large enough to review on its own

A layer that cannot be described in one sentence is usually two layers.

## One stack, one landing unit

A stack needs one coherent landing reason. A reviewer should be able to walk its PRs bottom to top
and understand why they merge together.

**Use a single stack** when every branch serves the same feature or when explicit repository policy
bundles several bounded issues into one release. In an issue batch, give each issue a focused layer,
order shared foundations and overlapping surfaces first, and reserve the top layer for any shared
integration or release artifact. Lack of a code dependency does not disqualify an issue from an
explicit shared release batch.

**Start a separate stack** when work should land or release independently. Do not mix efforts merely
because they happened concurrently. Use `gh stack init` for the new effort, or
`gh stack checkout <target>` to move between existing stacks.

A trivial incidental fix can ride along in the current stack. Once it grows into its own project, it
deserves its own stack.
