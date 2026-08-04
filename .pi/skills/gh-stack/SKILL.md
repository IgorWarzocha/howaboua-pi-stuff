---
name: gh-stack
description: "Native GitHub stacked-PR workflow via gh stack: plan dependent layers; create, submit, inspect, sync, rebase, restructure, and merge stacks. Use for stacked diffs, dependent branch chains, or incremental review; not independent PRs."
license: MIT
compatibility: "Requires authenticated GitHub CLI and the github/gh-stack extension; same-repository branches only"
---

# GitHub stacked PRs

## Guardrails

- Repository instructions and explicit user direction override this skill
- Use a stack only for a linear dependency chain. Keep independent changes in independent PRs; do not manufacture layers merely to shrink a diff
- Order layers bottom to top: foundations before dependants. Each layer must be cohesive and reviewable against the branch below it
- Inspect the working tree, remotes, trunk, current branch, existing PRs, and stack state before branch or history operations. Keep unrelated changes out
- Stacks require branches in one repository. Do not substitute a native stack for fork-based contribution work
- Cascading rebases rewrite every affected upstack branch. Do not rewrite shared or ambiguously owned branches without agreement
- Treat `submit`, `link`, `sync`, `push`, `unstack`, and `merge` as external writes. Infer authorization from a requested stacked-PR outcome, but never merge merely because a stack is ready

## Runtime contract

1. Run `gh stack --version`. If unavailable, install with `gh extension install github/gh-stack`, then retry
2. Use current `gh stack <command> --help` for exact flags when the installed version may differ from this skill
3. Keep agent calls noninteractive:
   - name every branch passed to `init` or `add`
   - use `gh stack submit --auto`; add `--open` only when PRs should leave draft state
   - inspect with `gh stack view --json` for machine decisions or `--short` for concise display
   - give `checkout` a stack number, PR number/URL, or branch
   - do not use interactive `modify` or `switch`
   - use `gh stack merge ... --yes` with an explicit merge method when merging is authorized
4. With multiple remotes, pass `--remote <name>` where supported and set repository-local `remote.pushDefault` only when commands without that flag need an unambiguous remote
5. If `rerere.enabled` is unset before `init`, set it repository-locally to `true` so initialization and repeated conflict resolution stay noninteractive

## Workflow

### Plan

Write the intended chain before creating branches:

```text
trunk <- foundation <- dependent change <- integration
```

Split at a dependency or review boundary, not by file count. If layer B can land without layer A, it probably belongs in another PR or stack.

### Create and submit

```sh
gh stack init --base <trunk> <bottom-branch>
# implement, validate, stage deliberately, commit
gh stack add <next-branch>
# repeat per dependency layer
gh stack submit --auto
gh stack view --json
```

- `init` can adopt existing branches when supplied bottom to top; inspect their ancestry first
- Use ordinary `git add` and `git commit` so each layer receives only its concern
- `submit --auto` creates drafts by default. Use `--open` only when validation and repository policy say the PRs are review-ready
- After submit, verify every layer's branch, base, PR URL, draft state, and stack order; successful pushes alone do not prove correct linkage

### Continue or repair a stack

When a higher layer reveals a lower-layer change:

```sh
gh stack checkout <lower-branch-or-pr>
# edit, validate, commit
gh stack rebase --upstack
gh stack push
gh stack view --json
```

Put the fix in the lowest layer that owns it. Never hide a foundation change in a dependant PR. After any cascading rebase, verify the full upstack and push all rewritten branches together.

For routine remote reconciliation:

```sh
gh stack sync
gh stack view --json
```

`sync` fetches, reconciles stack membership, rebases, pushes, and updates remote stack state. Its divergence path may print `Sync aborted` while exiting successfully; treat that message as no-op, not success.

### Link externally managed branches

Use `link` when another tool owns branch topology and only GitHub's native stack object is needed:

```sh
gh stack link --base <trunk> <bottom-branch-or-pr> <next> [<top>...]
```

Arguments are bottom to top. `link` may push branches, create PRs, correct PR bases, and alter remote stack membership; inspect before and verify after. Do not combine local `gh stack` ownership with jj, Sapling, git-town, or another stack manager accidentally.

### Merge

GitHub merges a selected PR and every unmerged layer below it, bottom first. Merging the top lands the whole stack; merging a middle PR lands the bottom portion and leaves higher layers open for automatic retargeting.

Before an authorized merge:

1. Inspect `gh stack view --json`
2. Confirm the intended highest PR, approvals, checks, draft state, merge method, and trunk
3. Run `gh stack merge <stack-or-pr> --yes` with one of `--squash`, `--rebase`, or `--merge`
4. Verify landed PRs and remaining layer bases. If a merge queue governs the trunk, report queued state rather than claiming merge completion

Do not use `gh pr merge` for a native stack.

## Recovery

- **Stack support unavailable:** report the repository/rollout failure. Do not silently create ordinary chained PRs
- **Rebase conflict:** inspect `git status` and conflict markers, resolve and stage only intended files, then `gh stack rebase --continue`. Use `--abort` when ownership or resolution is uncertain; verify every branch afterward
- **Local/remote divergence:** preserve both states until choosing an authority. If remote wins and the tree is clean, remove only local tracking with `gh stack unstack --local`, then check out the remote stack. If local wins, remote `unstack` and reconstruction alter GitHub state; proceed only when that outcome is authorized
- **Published restructure:** record PR numbers, branches, bases, and stack order first. `unstack` keeps PRs and branches but removes stack grouping; rebuild explicitly with `init` or `link`, then verify every base and PR
- **Checkout wants conflict resolution:** do not blindly discard local tracking. Inspect the mismatch; use `unstack --local` only after deciding GitHub is authoritative
- **Partial push/submit:** these operations may update some branches before another fails. Inspect remote heads and PRs, repair the rejected branch, then rerun idempotently
- **Authentication/API failure:** use `gh auth status`, preserve visible error details, and retry only after the permission or transient failure is resolved

## Finish

Report the stack bottom to top, PR links, current branch, external operations performed, validation, and any conflict, divergence, queued state, or remaining review blocker. Do not narrate routine navigation.
