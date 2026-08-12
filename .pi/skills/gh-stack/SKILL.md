---
name: gh-stack
description: "Operate native GitHub stacked PRs with gh stack: design layers, create or adopt stacks, submit, inspect, sync, rebase, restructure, and merge. Use for explicit stacks, dependent PRs, or issue batches intended to land as one release unit; not ordinary PR work."
license: MIT
compatibility: "Requires authenticated GitHub CLI and the github/gh-stack extension"
---

# gh-stack

A stack is a trunk-rooted branch chain. Each branch has a PR based on the branch below it, so its
diff shows only that layer. `gh stack` prints trunk first:

```text
(main) <- auth <- api <- frontend
```

Left is the **bottom** and merges first; right is the **top** and merges last. `up` moves away from
trunk; `down` moves toward it.

## Rules

- Repository instructions and explicit user direction override this skill.
- **Never merge a stack without explicit user approval.** Readiness, green checks, or a prior submit
  request is not merge authorization.
- Before creating or adopting a stack, verify the GitHub and Git author identities and isolate any
  checkout already owned by another task. A collaborator authors and pushes the stack as themself.
- The stack author does not approve their own PRs or switch identity to bypass protection. Surface known
  choices in each PR's review focus; an eligible maintainer owns approval and explicit merge direction.
- Stacks are linear. A layer may represent a code dependency or one bounded issue in an explicitly
  shared release batch. Keep work outside that release unit in another stack or PR.
- Before changing an existing stacked branch or PR, run `gh stack sync`, verify it did not print
  `Sync aborted`, then inspect `gh stack view --json`. If sync reports divergence or the target is
  absent, read `references/troubleshooting.md` before rewriting. Branch ancestry and PR bases do
  not replace native stack state.
- Create the chain before implementation. Put each change on the lowest layer that owns it; edit a
  lower owner, cascade-rebase upstack, then return to the top.

Read `references/stack-design.md` before choosing layers.

## Setup

```bash
gh stack --version || { gh extension install github/gh-stack && gh stack --version; }
git config rerere.enabled true
```

The contracts below target `gh stack` v0.1.0. If the installed version differs, current command
help wins.

With several remotes, pass `--remote <name>` where supported or configure one unambiguous remote
before noninteractive use.

## Noninteractive use

`gh stack` treats terminal stdout as interactive. Run it **without a PTY**: under a PTY, bare
commands may prompt or open a full-screen TUI. Still use explicit arguments and flags:

| Run                                       | Never run bare      | Why                              |
| ----------------------------------------- | ------------------- | -------------------------------- |
| `gh stack view --json`                    | `gh stack view`     | bare view opens a TUI            |
| `gh stack submit --auto`                  | `gh stack submit`   | prompts for each new PR title    |
| `gh stack merge <target> --yes --squash`  | `gh stack merge`    | prompts for scope and method     |
| `gh stack init <branch>...`               | `gh stack init`     | prompts for branch names         |
| `gh stack add <branch>`                   | `gh stack add`      | prompts for a name               |
| `gh stack checkout <target>`              | `gh stack checkout` | opens a selection menu           |
| `gh stack up` / `down` / `top` / `bottom` | `gh stack switch`   | `switch` is menu-only            |
| —                                         | `gh stack modify`   | TUI-only; no noninteractive path |

`view --short` is safe but human-formatted; parse `--json`. Use current
`gh stack <command> --help` for exact flags; `gh stack help <command>` only prints top-level help.

## Create and submit

Create one branch at a time while implementing dependent layers:

```bash
gh stack init --base <trunk> <bottom-branch>
# edit, validate, stage deliberately, commit
gh stack add <next-branch>
# repeat
gh stack submit --auto --open
gh stack view --json
```

Or create/adopt a planned issue-batch chain upfront, bottom to top, before assigning its branches:

```bash
gh stack init --base <trunk> <issue-branch-1> <issue-branch-2> <issue-branch-3>
```

`init` checks out the final branch. Existing branches are adopted; new ones are created in chain
order. Inspect existing ancestry first. Use ordinary `git add` and `git commit` so each branch owns
only its concern.

`submit --auto --open` pushes active branches, creates or opens PRs, updates existing PRs where
possible, and links them into a GitHub stack. Omit `--open` only when drafts were explicitly requested.
Use `gh pr edit` afterward for custom titles and bodies. Submit is not atomic; rerun it after a partial
failure.

## Edit a lower layer

```bash
gh stack view --json
gh stack down                    # or checkout the owning branch or PR
# edit, validate, commit
gh stack rebase --upstack
gh stack top
gh stack push
```

`push` updates active branches with per-branch force-with-lease and can partially succeed. Inspect
remote heads after failure, repair the rejected branch, and rerun.

## Synchronize

```bash
gh stack sync
gh stack view --json
```

`sync` fetches, reconciles GitHub stack membership, fast-forwards trunk, cascade-rebases, atomically
pushes active branches, refreshes PR state, and updates the GitHub stack object. Add `--prune` only
to delete local merged branches. On local/remote topology divergence it can print `Sync aborted`
while exiting 0; that means no changes were made.

## Link externally managed branches

```bash
gh stack link --base <trunk> <bottom-branch-or-pr> <next> [<top>...]
```

`link` creates or updates only the GitHub stack, with no local tracking state. It may push branch
arguments, create PRs, and correct bases. Use it when another branch manager or worktree workflow
owns topology; use `checkout <stack-or-pr>` later if local tracking is needed.

## Merge

After the user explicitly approves the merge, scope it with a PR or stack number and state the
method:

```bash
gh stack merge <target> --yes --squash  # or --merge / --rebase
```

A PR target merges that PR and every unmerged PR below it; a stack target merges the whole stack.
Direct stack merges are all-or-nothing. A merge queue overrides the method and may land queued PRs
in separate groups. Do not use `gh pr merge` for a native stack.

## Machine-readable state

`gh stack view --json` writes JSON to stdout; status text goes to stderr. Its stable fields are:

```text
trunk           string
currentBranch   string
branches[]      name, head, base, isCurrent, isMerged, isQueued, needsRebase
branches[].pr   number, url, state ("OPEN" | "MERGED" | "QUEUED"); absent without a PR
```

`base` is the saved parent SHA and can lag the parent's tip. `needsRebase` reports that the current
parent tip is no longer an ancestor of the branch.

## Exit codes

| Code | Meaning                  | Recovery                                                  |
| ---- | ------------------------ | --------------------------------------------------------- |
| 0    | Success                  | Check output: divergent `sync` can still abort            |
| 1    | Generic error            | Read stderr                                               |
| 2    | Not in a stack           | `init`, or `checkout <stack-or-pr>`                       |
| 3    | Rebase conflict          | Resolve and stage, then `rebase --continue`; or `--abort` |
| 4    | GitHub API failure       | Check `gh auth status`, then retry                        |
| 5    | Invalid arguments        | Fix invocation from `<command> --help`                    |
| 6    | Disambiguation required  | Use a branch unique to the intended stack                 |
| 7    | Rebase already active    | `rebase --continue` or `--abort`                          |
| 8    | Stack file locked        | Retry after the other process releases it                 |
| 9    | Stacked PRs unavailable  | Report repository availability                            |
| 10   | Modify recovery required | `gh stack modify --abort`                                 |

After a failed `sync`, branches have already been restored; run `gh stack rebase` to recreate a
conflict before resolving it.

## References

Open only what the task needs:

- `references/stack-design.md` — planning layers, branch names, and release batches
- `references/commands.md` — command preconditions, side effects, atomicity, and ordering
- `references/troubleshooting.md` — conflicts, squash merges, divergence, restructuring, and
  external branch managers
