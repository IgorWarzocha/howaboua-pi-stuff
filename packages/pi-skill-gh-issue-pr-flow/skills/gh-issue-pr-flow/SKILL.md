---
name: gh-issue-pr-flow
description: "GitHub issue/PR delivery via gh: issues, branches, commits, pushes, PRs, Codex review, feedback, release hygiene. Use for issue/PR work as portable fallback; repo rules override."
---

# GitHub Issue and PR Flow

## Operating rules

- Explicit user direction and repository instructions take precedence.
- Use `gh` for GitHub operations when available.
- Read relevant repository instructions and the supplied issue, PR, comments, or reviews before acting.
- Inspect the working tree, current branch, upstream, remote default branch, and intended PR base before branch or history operations.
- Keep unrelated local changes out of the work. Proceed around them when safe; ask only when they block branch switching, staging, validation, or the requested result.
- Infer ordinary workflow details from the repo and request. Ask only when ambiguity would produce a surprising base, scope, destructive action, or external result.
- Treat actions implied by the requested outcome as authorized. “Open a PR” includes the normal branch, commit, push, and PR creation steps. “Update this PR” or “address review feedback” includes committing and pushing in-scope fixes to its branch.
- Do not create unrelated GitHub side effects. Filing an issue does not authorize implementation; preparing a PR body does not authorize opening the PR; opening a PR does not authorize requesting review unless requested or locally required.
- Never use plain `--force`. Use `--force-with-lease` only when rewriting your own branch is clearly safe; ask when the branch is shared or ownership is unclear.
- Repository conventions outrank generic preferences for labels, projects, milestones, templates, branch names, validation, and release tooling.

## Route the requested work

### File or update an issue

1. Distill the request or conversation into a concrete title, context, scope, and completion conditions.
2. Check for an issue template and obvious duplicates when that check is useful.
3. Apply labels, projects, milestones, or assignees only when the user or repository establishes them.
4. Create or update the issue, return its link, and stop unless implementation was also requested.

### Implement an issue and open a PR

1. Read the issue and any discussion before editing.
2. Establish the correct base and branch state. Start a focused branch from the current target branch unless the current branch is already clearly dedicated to this work.
3. Implement only the agreed scope. If a materially separate problem appears, leave it out or raise it rather than silently expanding the PR.
4. Run relevant validation chosen from repository guidance and the changed surface.
5. If the work is intended to ship a package or includes release readiness, read `references/release-and-repository-hygiene.md` and apply the relevant policy.
6. Review the diff, stage only intended files, and commit the completed outcome.
7. Push and open the PR against the correct base. Return the PR link.

### Open or update a PR for existing work

1. Inspect the branch history, diff, intended base, and any existing PR before acting.
2. Confirm that the branch contains only the intended commits. Repair stale or mixed history safely instead of laundering it into the PR.
3. Validate the actual changed surface, then push and create or update the PR.
4. Update the PR body when scope, validation, issue linkage, risk, or follow-up information changed materially.

### Handle review feedback

1. Read all review comments and current code before editing.
2. Verify every finding against the PR goal, repository rules, and implementation. Reviewer categories do not override evidence.
3. Fix required findings unless they are factually wrong or outside the agreed scope.
4. Fix recommended findings when they are clearly beneficial and in scope.
5. Avoid optional churn. Ask when an optional or context-dependent change would materially alter scope or product behavior.
6. Revalidate, commit, and push the in-scope fixes. Summarize what was fixed, rejected, or deferred and why.

## Git and branch hygiene

- Fetch current remote state before choosing a base or repairing history.
- Prefer a focused branch based on the PR target. Follow repository instructions for long-lived branches, rebases, resets, merge queues, or stacked work.
- Do not overwrite, stash, reset, or include unrelated local changes merely to make the workflow convenient.
- Do not amend or rewrite published shared history. Rewriting your own branch may be appropriate when it produces the intended clean PR and can be pushed safely with lease protection.
- If a push is rejected, fetch and inspect the divergence before deciding whether to rebase, merge, reset, or push with lease protection.

## GitHub writing

- Write issue and PR bodies for the next human: state the goal, material context, actual change, validation, and unresolved risk without narrating routine mechanics.
- Link issues with `Closes #123` only when the PR fully resolves them. Use `Refs #123` for partial or related work.
- For multiline issue bodies, PR bodies, and comments, write Markdown to a temporary file and use `--body-file`. Do not pass shell strings containing `\n`; GitHub will render literal escape text.
- Follow repository templates where present, but remove placeholder sections that do not apply.
- Do not invent release history, labels, milestones, or certainty that the available evidence does not support.

## Codex review request

Post a Codex review request only when the user asks or repository instructions require it. Do not post it automatically for every PR, and do not repost it after every update unless requested.

Use this exact comment:

```text
@codex please review this PR and give me 10-20 issues if any. Categorize findings as required, recommended, or optional.
```

Post it through a Markdown body file like other multiline GitHub comments.

## Validation and release discipline

- Choose validation from the changed surface and repository instructions. Do not run expensive, destructive, or forbidden commands merely because they are common elsewhere.
- Report relevant checks and failures. If an expected check was skipped, state the concrete reason.
- For package publication, changelogs, versioning, release notes, and funding metadata, use `references/release-and-repository-hygiene.md`. The repository's established release system always wins.

## Failure handling

- **`gh` is unauthenticated:** report the visible authentication or permission problem and the relevant login step; do not substitute blind browser instructions.
- **Base remains unclear:** inspect the remote default, current PR conventions, and repository instructions; ask before targeting a surprising branch.
- **Unrelated changes block the work:** explain the exact collision and ask whether to preserve them in place, move the work elsewhere, or include them.
- **History repair could affect another contributor:** stop before reset, rebase, deletion, or force pushing and ask.
- **Review findings conflict:** explain the evidence and preserve the user or product decision instead of mechanically satisfying every reviewer.

## Finish

Return links for every created or updated GitHub artifact. Summarize the material result, relevant validation, current branch or PR state, and any intentionally deferred risk. Do not pad the report with successful hygiene checks or routine command narration.
