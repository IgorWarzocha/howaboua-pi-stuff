# Merge a stack

Use this phase for maintainer approvals, whole or partial atomic merge, and reconciliation afterward.

## Authorization and readiness

Merge only after explicit user direction names or unambiguously selects the intended boundary. A PR
target merges that PR and every unmerged PR below it; a stack target merges every unmerged member.
Never broaden the target to satisfy a rule.

Before final approval, check out the top PR and validate the integrated filesystem state:

```bash
gh stack checkout <top-pr>
gh stack top
git status --short --branch
# run the repository umbrella gate once
```

There is no separate aggregate branch: the top branch contains every unmerged lower layer by ancestry.
After a partial merge and sync, it contains the merged layers through trunk plus the remaining top
changes. Its working tree is therefore the final candidate even though its focused PR diff correctly
shows only work not already on trunk.

Before merging, inspect the native range and confirm every included PR is open, non-draft, approved,
green, and free of unresolved required threads:

```bash
gh stack view --json
gh pr view <pr> --json state,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup
gh stack merge --help
```

The stack author cannot approve their own work. When the user has established an eligible maintainer
login, use that account's token only for the approval command; never switch the active `gh` account:

```bash
: "${pr:?set PR to approve}"
: "${reviewer:?set eligible reviewer login}"
review_token=$(gh auth token --user "$reviewer")
test "$(GH_TOKEN="$review_token" gh api user --jq .login)" = "$reviewer"
GH_TOKEN="$review_token" gh pr review "$pr" --approve
```

Approvals attach to current heads and may be dismissed by a later push or cascade rebase.

## Merge the chosen range

State the method and suppress prompts:

```bash
# Whole stack selected by its top PR
gh stack merge <top-pr> --yes --squash

# Partial stack: merge through this PR, leave every upper PR open
gh stack merge <highest-pr-to-land> --yes --squash
```

Use `--merge` or `--rebase` only when deliberately selected. The operation prints its exact PR list and
is all-or-nothing: if one member fails repository rules, none merge. A merge queue overrides the method
and may land members in separate groups; use an integration PR instead when one push/release run is
mandatory. Native stacks do not support bypassing repository rules.

## Code-owner rejection

GitHub's atomic endpoint can report `Waiting on code owner review from <login>` even when every PR in
the requested range is clean and approved by that owner. First confirm the failure merged nothing and
the intended PR boundary was correct. Do not approve or merge an out-of-range cap merely to widen the
operation, and do not fall back to serial `gh pr merge` calls.

If the failed mutation ran as the stack author, retry the exact target with the required code owner's
token for this command only:

```bash
: "${target_pr:?set the highest PR that should merge}"
: "${code_owner:?set the required code-owner login}"
owner_token=$(gh auth token --user "$code_owner")
test "$(GH_TOKEN="$owner_token" gh api user --jq .login)" = "$code_owner"
GH_TOKEN="$owner_token" gh stack merge "$target_pr" --yes --squash
```

Observed behavior: approving the open cap and retrying as the stack author still failed; the same
lower-PR target succeeded when submitted by the code owner. Treat this as endpoint behavior, not proof
that an excluded upper PR needs approval.

## Reconcile after merge

A squash replaces original commits. Let the stack tool skip merged layers and replay any remaining
upper branches onto trunk:

```bash
gh stack sync
gh stack view --json
```

For a partial merge intended to leave one cap, verify every lower PR is `MERGED`, the cap is `OPEN`,
its base is trunk, native state reports no rebase need, and its refreshed CI state is visible:

```bash
gh pr view <remaining-pr> \
  --json state,baseRefName,headRefOid,reviewDecision,mergeStateStatus,statusCheckRollup
git status --short --branch
```

Do not merge the remaining PR without a new explicit instruction. If `sync` conflicts, it restores the
stack; follow the rebase recovery in `work.md`.
