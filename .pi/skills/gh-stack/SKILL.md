---
name: gh-stack
description: "Native GitHub stacks with live umbrella release PRs and JJ/Git history. Use for designing, creating/linking, updating, reviewing, assembling, or merging dependent PR stacks; not ordinary independent PRs."
license: MIT
compatibility: "Requires authenticated GitHub CLI and github/gh-stack; JJ is preferred for local stack history"
---

# gh-stack

A release stack has two GitHub surfaces:

```text
main <- umbrella PR (ordinary, cumulative, only main landing)

staging trunk <- bottom <- middle <- top   (focused native stack)
```

The umbrella head follows the focused top during review but is not a native stack member. The native
stack assembles into staging; staging then replaces the umbrella head for final aggregate review.

## Boundaries

- Repository instructions and explicit user direction override this skill.
- Never assemble or merge without explicit user approval. Readiness, green checks, approval requests,
  and submit requests are not merge authorization. Final umbrella merge needs separate authorization
  after assembly.
- Before the first write, verify GitHub and author identities and isolate work owned by another task.
- The author does not approve their own PRs or switch identities to bypass protection.
- Keep focused layers linear and independently reviewable. Put each change on its lowest owner.
- For one release unit, create a staging branch from `main`, root the native stack there, and keep a
  separate ordinary umbrella PR to `main`. Neither staging nor umbrella belongs to the native stack.
- The umbrella is the cumulative release view, stays draft until assembly, and is the only PR merged
  to `main`. Never merge native members with `gh pr merge`.
- Prefer JJ revisions/bookmarks/workspaces for local history. Use `gh stack link` for GitHub topology;
  do not adopt the same stack into local `gh-stack` tracking or mix in `sync`, `rebase`, or `push`.
- If JJ is unavailable, use the explicit Git-managed fallback. One local-history owner per stack.
- Native GitHub stack state is authoritative for membership and order; ancestry and PR bases alone
  are insufficient.

## Route

Read the phase reference before acting; load another only when crossing its boundary.

- **Plan, create bookmarks/branches, link focused PRs, open umbrella:** `references/create.md`
- **Inspect, edit, rebase, push, or restructure:** `references/work.md`
- **Review focused PRs and cumulative umbrella:** `references/review.md`
- **Approve, assemble into staging, refresh umbrella, or merge:** `references/merge.md`

## Command contract

Use `gh stack <command> --help`; installed help wins. Run without a PTY. Bare commands may prompt or
open a TUI.

JJ route:

- `jj` owns revisions, order, conflicts, bookmarks, and workspaces.
- Focused bookmarks are listed bottom to top in `gh stack link --base <staging> ...`.
- A separate umbrella bookmark points at the cumulative top and is pushed with `jj git push`.
- `gh stack link` and `merge` own remote topology and landing; never run locally mutating
  `gh stack init/add/sync/rebase/push/submit` for that stack.
- Inspect externally managed native order through `gh api
  "repos/{owner}/{repo}/stacks?pull_request=<focused-pr>"`; bare `view` needs local tracking.

Git fallback:

- `gh stack init/add/sync/rebase/push/submit` owns local and remote focused stack state.
- The umbrella remains a separate branch/ordinary PR and never enters `.git/gh-stack`.

For the Git fallback, parse `gh stack view --json`. Stable fields:

```text
trunk, currentBranch
branches[]: name, head, base, isCurrent, isMerged, isQueued, needsRebase
branches[].pr: number, url, state (OPEN | MERGED | QUEUED)
```

`base` is the saved parent SHA and may lag the parent tip; `needsRebase` reports ancestry.

The remote Stacks REST response is authoritative for JJ-linked stacks: `number`, `base.ref`, and
ordered `pull_requests[]` entries with `number`, `state`, `draft`, `merged_at`, and `head.{ref,sha}`.
