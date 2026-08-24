Review focused PRs against their direct parents. Review the umbrella once for cumulative release scope, integration, changesets, and final landing confidence. Do not repeat focused line review on the umbrella.

## Establish exact boundaries

```bash
gh api "repos/{owner}/{repo}/stacks?pull_request=<focused-pr>"
gh pr view <focused-pr> --json number,title,body,baseRefName,headRefName,headRefOid,state,reviews,statusCheckRollup
gh pr view <umbrella-pr> --json number,title,body,baseRefName,headRefName,headRefOid,isDraft,state,reviews,statusCheckRollup
jj log -r '<staging>::<umbrella>'
```

Require the JJ graph, focused direct bases, native order, and umbrella head to describe the same cumulative history.

For each focused layer, read its issue, comments, direct-parent diff, and owning paths. Check that implementation and direct package changeset stay in the lowest owning layer. Apply the repository's contract-spine test policy rather than retaining feature tours.

After focused review converges, inspect the umbrella for:

- intended package set and one release unit
- all direct changesets and no hand-authored aggregate changesets
- cumulative conflicts or unrelated commits
- one final umbrella gate from the cumulative top
- accurate focused-PR links, release effects, and validation

Parallel reviewers stay read-only. Apply accepted fixes through one JJ writer at a time, bottom to top, updating stale workspaces between layers. Triage findings before involving the user: reproduce plausible faults, reject impossible states, and collapse duplicates.

Request bot review only when the user asks or repository instructions require it. Focused reviews happen after titles, bodies, order, and heads settle. The umbrella receives a separate release-level review only after assembly.
