---
name: gh-stack
description: "Operate native GitHub stacked PRs with gh stack. Use when designing or creating a stack, updating or reviewing stacked branches and PRs, repairing stack state, approving layers, or merging part or all of a stack; not ordinary independent PRs."
license: MIT
compatibility: "Requires authenticated GitHub CLI and the github/gh-stack extension"
---

# gh-stack

A native stack is a trunk-rooted branch chain:

```text
(main) <- bottom <- middle <- top
```

Left merges first. `up` moves away from trunk; `down` moves toward it. Each PR targets the branch
immediately below, so its ordinary diff contains only that layer.

## Boundaries

- Repository instructions and explicit user direction override this skill.
- Never merge without explicit user approval. Readiness, green checks, approval requests, or submit
  requests are not merge authorization.
- Before the first write, verify GitHub and Git author identities and isolate a checkout owned by
  another task. A collaborator authors and pushes as themself.
- The stack author does not approve their own PRs or switch identities to bypass protection. An
  eligible maintainer owns approval and explicit merge direction.
- Treat native stack state as authoritative. Branch ancestry and PR bases do not prove GitHub stack
  membership or order.
- Keep stacks linear. Put each change on its lowest owning layer and keep unrelated release units in
  another stack or PR.
- Never merge a native stack with `gh pr merge`.

## Route

Read the reference for the current phase before acting. Load another only when the operation crosses
that boundary.

- **Plan, create, adopt, link, or submit:** `references/create.md`
- **Inspect, update, rebase, push, or restructure:** `references/work.md`
- **Review focused PRs, run review agents, or request bot reviews:** `references/review.md`
- **Approve, partially merge, fully merge, or reconcile after merge:** `references/merge.md`

## Command contract

Use `gh stack <command> --help`; `gh stack help <command>` only prints top-level help. These contracts
target v0.1.0, but installed command help wins.

Run without a PTY. Bare `view`, `submit`, `init`, `add`, `checkout`, `merge`, and `switch` may prompt
or open a TUI. Use explicit arguments and flags. `gh stack modify` is TUI-only; restructure through
the documented noninteractive path instead.

Parse `gh stack view --json`, whose stable fields are:

```text
trunk, currentBranch
branches[]: name, head, base, isCurrent, isMerged, isQueued, needsRebase
branches[].pr: number, url, state (OPEN | MERGED | QUEUED)
```

`base` is the saved parent SHA and can lag the parent's tip. `needsRebase` reports whether the parent
tip is still an ancestor.
