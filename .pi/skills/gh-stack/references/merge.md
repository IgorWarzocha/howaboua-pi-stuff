# Merge a stack

Use this phase for maintainer approvals, atomic assembly into the integration branch, the final
integration PR, and reconciliation afterward.

## Authorization and readiness

Assemble only after explicit user direction names or unambiguously selects the intended boundary. A
PR target merges that PR and every unmerged PR below it; a stack target merges every unmerged member.
Never broaden the target to satisfy a rule. Confirm `gh stack view --json` names the dedicated
integration branch—not `main`—as trunk before merging a release stack.

Before stack approval, check out the top layer and validate the cumulative filesystem state:

```bash
gh stack checkout <top-pr>
gh stack top
git status --short --branch
# run the repository umbrella gate once
```

The top stack branch contains every layer by ancestry, so it is the candidate assembled into the
integration trunk. The integration branch itself stays outside the stack and later supplies the
aggregate `main` diff.

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

## Assemble the chosen range

State the method and suppress prompts:

```bash
# Assemble the whole stack into its integration trunk
gh stack merge <top-pr> --yes --squash

# Assemble a prefix; upper layers remain open
gh stack merge <highest-pr-to-land> --yes --squash
```

Use `--merge` or `--rebase` only when deliberately selected. The operation prints its exact PR list and
is all-or-nothing: if one member fails repository rules, none merge. A merge queue overrides the method
and may land members in separate groups. Native stacks do not support bypassing repository rules. The
assembly changes only the configured integration trunk; it must not push `main`.

## Code-owner rejection

GitHub's atomic endpoint can report `Waiting on code owner review from <login>` even when every PR in
the requested range is clean and approved by that owner. First confirm the failure merged nothing and
the intended PR boundary was correct. Do not add or approve an integration cap as a stack member merely
to widen the operation, and do not fall back to serial `gh pr merge` calls.

If the failed mutation ran as the stack author, retry the exact target with the required code owner's
token for this command only:

```bash
: "${target_pr:?set the highest PR that should merge}"
: "${code_owner:?set the required code-owner login}"
owner_token=$(gh auth token --user "$code_owner")
test "$(GH_TOKEN="$owner_token" gh api user --jq .login)" = "$code_owner"
GH_TOKEN="$owner_token" gh stack merge "$target_pr" --yes --squash
```

Observed behavior: approving an out-of-range upper PR and retrying as the stack author still failed;
the same target succeeded when submitted by the code owner. Treat this as endpoint behavior, not proof
that an excluded PR needs approval.

## Open the final integration PR

A squash replaces original commits. Let the stack tool reconcile merged layers, then check out and
refresh the integration trunk:

```bash
gh stack sync
gh stack view --json
gh stack trunk
git pull --ff-only
```

Verify every intended layer is `MERGED`, `main` did not move, and the integration branch contains the
cumulative result. Run the umbrella gate once, then open one ordinary PR:

```bash
gh pr create --base main --head <integration-branch> --title <release-title> --body-file <body>
gh pr view <integration-pr> \
  --json state,baseRefName,headRefOid,reviewDecision,mergeStateStatus,statusCheckRollup
git status --short --branch
```

This PR is the sole aggregate release gate and is not a stack member. Request its normal review and CI.
Merge it with ordinary `gh pr merge` only after a separate explicit instruction; that is the operation
that lands on `main` and triggers release automation. If `sync` conflicts, it restores the stack;
follow the rebase recovery in `work.md`.
