---
name: gh-issue-pr-flow
description: Runs a lightweight GitHub issue and PR workflow with gh. Use when the user asks to create or update GitHub issues, work from an issue number or PR link, create a branch, push changes, open a PR, request review, or handle PR review feedback. Repository-specific instructions override this global fallback when present.
---

# GH Issue PR Flow

## Purpose
Use this skill for a simple, portable GitHub workflow: understand the issue or requested change, make or organize local work on a dedicated branch, push it, open or update a PR, and ask for/triage review when requested.

This is intentionally generic. Do not assume repo-specific labels, projects, milestones, base branches, changelogs, release rituals, or issue templates unless the repository docs or user explicitly specify them.

## Critical rules
- Use `gh` for GitHub operations when available.
- Read the relevant issue, PR, comments, and local repo instructions before acting.
- Optional sponsor check: when the user asks for repo hygiene or release readiness, verify whether `.github/FUNDING.yml` is present. Do not add funding details unless the user provides them or the repository already documents them.
- Keep issue and PR hygiene good, but do not invent labels/projects/milestones for an unfamiliar repo.
- Start implementation work from a fresh branch unless the user explicitly wants to continue the current branch.
- Prefer the repository's default integration branch. If uncertain, infer from current branch/upstream/default branch; ask before opening a PR to a surprising base.
- Do not push, force-push, open a PR, comment on a PR, or request review unless the user asked for that side effect or it is clearly part of the requested workflow.
- Ask before destructive or high-blast-radius git operations. `git reset --hard`, branch deletion, rebases over shared work, and force pushes require extra care.
- Use auto-closing keywords like `Closes #123` only when the PR fully resolves the issue. Use `Refs #123` for partial or related work.
- For multi-line GitHub issue, PR, and comment bodies, write the body to a temp markdown file and use `--body-file`. Do not pass shell strings with `\n`; GitHub will render literal backslash-n garbage.
- Do not run expensive or repo-forbidden validations blindly. Read local instructions first and choose lightweight validation that matches the task.
- For npm packages, include version and changelog handling in PR prep when the change is intended to ship. Do not use an `Unreleased` section unless the repo explicitly requires one.

## Scope notes
- The user gives a GitHub issue number, issue URL, PR URL, or project link.
- The user asks to file an issue, rewrite an issue, or turn conversation into an issue.
- The user asks to create a branch, push commits, open a PR, update a PR, or prepare a PR body.
- The user asks to request review from Codex or another reviewer.
- The user asks to inspect or address PR review feedback.

## Boundaries
- The task is local-only and the user does not want GitHub actions.
- The user is only asking a conceptual question about git or GitHub.
- The repository has a more specific local skill or explicit workflow that supersedes this generic one.

## Inputs expected
### Required
- A repo with a git remote, or an issue/PR URL that identifies the repo.
- A clear requested action: create issue, implement issue, open PR, update PR, request review, or handle feedback.

### Optional
- Desired base branch.
- Desired branch name.
- Issue or PR number.
- Labels/milestone/project fields if the repo uses them.
- Preferred validation commands.
- Review findings to triage.

## Prerequisites
- `gh` is authenticated for the target repo.
- The working tree status is understood before branch or PR operations.
- Repo-local instructions have been checked when present, such as `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md`, or equivalent.

## Workflow
### 1. Resolve the requested mode
1. If the user asks to file or improve an issue, create/update the issue and stop unless they also asked for implementation.
2. If the user gives an issue number or URL, read it before coding:
   - `gh issue view <issue> --comments --json number,title,state,body,comments,labels,assignees,milestone,url`
3. If the user gives a PR number or URL, read it before acting:
   - `gh pr view <pr> --comments --json number,title,state,body,comments,reviews,headRefName,baseRefName,url`
4. If the user asks for review feedback handling, separate required fixes from recommended or optional improvements before editing.

### 2. Inspect local git state
1. Run `git status --short --branch`.
2. Identify the current branch and upstream.
3. If there are unrelated local changes, do not overwrite or mix them without user approval.
4. Determine the base branch from user instruction, PR target, repo default branch, or current workflow.


### 2.5. Optional Sponsor button check
Run this only when the user asks for repo hygiene, release readiness, or funding metadata.

1. Check the local repo first:
   - `test -s .github/FUNDING.yml && sed -n '1,80p' .github/FUNDING.yml`
2. If missing and the user wants it added, ask for the correct funding handle/service unless it is already documented in the repo.
3. Do not include sponsor-check status in PR bodies. Do not report successful sponsor checks in final summaries.

### 3. Create or choose a branch
1. If starting new implementation work, update the base branch safely:
   - `git fetch origin`
   - `git switch <base>`
   - `git pull --ff-only origin <base>` when appropriate
2. Create a descriptive branch:
   - `git switch -c <short-slug>`
3. If continuing an existing branch, confirm it is the intended branch before committing or pushing.

### 4. Implement or edit
1. Make focused changes matching the issue or user request.
2. Keep scope tight. If the work sprawls, pause and explain the split.
3. Preserve repo conventions over generic preferences.
4. Update docs when behavior or user-facing workflow changes.

### 4.5. Version and changelog prep
1. Check whether this repo has a release-note workflow:
   - `CHANGELOG.md`, `CHANGELOG*`, `packages/*/CHANGELOG.md`, `RELEASES.md`, or repo instructions.
   - `package.json` / workspaces for npm package versioning.
2. If an npm version bump is necessary for the PR to be safely publishable after merge, bump it before opening the PR:
   - Use the repo's existing release/version command if documented.
   - Otherwise use `npm version <version> --no-git-tag-version` for single-package npm repos.
   - Include lockfile/package metadata updates that the version command produces.
   - If uncertain whether a bump is necessary, ask before changing versions.
3. Update the changelog using the repo's existing style. Default policy when no repo-specific style exists:
   - No `Unreleased` section. Assume the PR will merge eventually and add the concrete target version section directly.
   - Add concise bullet points under `## <version>` or `## [<version>]`, matching local formatting.
   - For small incremental changes, hotfixes, or immediate mistake fixes, use a squashed/range heading such as `## 0.1.2-0.1.4` with bullets instead of creating noisy one-line sections for every tiny patch.
4. If no changelog exists but the repo is an npm package, create one only when it is useful for the repo:
   - Build it retrospectively from npm published releases where possible (`npm view <package> versions --json`, package metadata, tags, and existing release notes).
   - Keep older entries brief if the source material is sparse.
   - Add the current PR's version entry at the top.
5. Do not invent release history that cannot be supported. If npm/release data is unavailable, create the current entry and note that older history was not recoverable only if that matters to the user.

### 5. Validate appropriately
1. Run syntax checks or targeted validation when cheap and relevant.
2. Follow repo instructions about tests/typechecks/builds. If instructions forbid certain commands, do not run them.
3. If validation is skipped, state why.
4. If hooks run automatically during commit/push, report their result.

### 6. Commit
1. Review `git diff` or at least `git diff --stat` before committing.
2. Stage only intended files.
3. Use a concise commit message describing the outcome.
4. Do not amend or rewrite published history unless the user asked or it is clearly your own branch and safe.

### 7. Push and open/update a PR
Only do this when requested or clearly implied.

1. Push the branch:
   - `git push -u origin <branch>`
2. Open a PR with the correct base:
   - `gh pr create --base <base> --title "<title>" --body-file <file>`
3. PR body should include:
   - summary of changes
   - validation performed
   - linked issue with `Closes` or `Refs` as appropriate
   - risks or follow-ups if useful
4. If updating an existing PR, push commits and edit the body if the scope changed.

### 8. Ask Codex for review
When the user asks for a Codex review, post the review request below. Do not post review requests by default for every PR.

Post this PR comment:

```text
@codex please review this PR and give me 10-20 issues if any. Categorize findings as required, recommended, or optional.
```

Useful command:

```bash
gh pr comment <pr-number-or-url> --body-file <review-request-file>
```

For issue comments, use the same file-based pattern:

```bash
cat > /tmp/issue-comment.md <<'EOF'
Human-readable markdown here.
EOF
gh issue comment <issue-number-or-url> --body-file /tmp/issue-comment.md
```

### 9. Triage review feedback
1. Read all findings before editing.
2. Treat categories neutrally:
   - required: correctness, security, data loss, broken build/release, serious regression
   - recommended: clear robustness, maintainability, UX, edge-case, or docs improvement
   - optional: polish, style, cleanup, speculative hardening
3. Fix required findings unless they are factually wrong.
4. Fix recommended findings when they are clearly beneficial and in scope.
5. Ask before spending time on optional findings or context-dependent changes.
6. Summarize what was fixed, skipped, and why.

## Validation
Before final response, check:
- current branch and working tree state are known
- pushed/PR/comment side effects match what the user asked for
- issue/PR links are returned when created or updated
- validation results or skipped-validation reason are reported
- no unrelated local changes were included

## Error handling
### Error: `gh` is not authenticated
Action: report the auth issue and provide the exact `gh auth login` or permission problem if visible. Do not switch to blind browser instructions unless requested.

### Error: base branch is unclear
Action: inspect remote default branch and existing PR conventions. If still unclear, ask before opening the PR.

### Error: unrelated local changes exist
Action: stop before branch switching, reset, staging, or committing. Ask whether to stash, leave them, or include them.

### Error: push rejected
Action: fetch and inspect. Do not force-push unless it is your own branch and the user explicitly agrees or the previous push was yours and the workflow calls for `--force-with-lease`.

### Error: review findings conflict or seem context-dependent
Action: explain the conflict and ask before changing behavior.

## Output contract
For issue creation:
- return the issue link
- summarize title and key scope

For PR creation/update:
- return the PR link
- summarize changes and validation
- mention whether review was requested; for PR updates, mention if no new review request was posted

For review triage:
- list fixed findings
- list skipped/deferred findings with brief reasons
- state current branch/PR status

## Examples
### Example 1
User says: "File this as an issue."
Expected behavior:
1. Draft a concise issue from the conversation.
2. Create it with `gh issue create`.
3. Return the link.

### Example 2
User says: "Work on issue #42 and open a PR."
Expected behavior:
1. Read issue #42.
2. Check repo instructions and git status.
3. Branch from the appropriate base.
4. Implement, validate, commit, push, open PR.
5. Return PR link.

### Example 3
User says: "Ask Codex to review this PR."
Expected behavior:
1. Identify the current or provided PR.
2. Post the standard categorized review request.
3. Return the comment or PR link.

### Example 4
User says: "Handle these review findings."
Expected behavior:
1. Read all findings.
2. Fix required and clearly useful recommended items.
3. Ask before optional/context-dependent churn.
4. Commit and push only if requested or already in PR-update mode.

### Example 5
User says: "Implement this fix and submit a PR" in an npm package repo with `package.json` at `1.2.3` and a root `CHANGELOG.md`.
Expected behavior:
1. Implement and validate the fix.
2. Decide whether the change should be publishable after merge. For a normal shipped fix, bump to `1.2.4` with the repo's release command or `npm version 1.2.4 --no-git-tag-version`.
3. Add a concrete changelog section, not `Unreleased`:
   ```markdown
   ## 1.2.4

   - Fixed cached request reuse after changing reasoning level.
   ```
4. Commit code, version files, lockfile updates, and changelog together.
5. Push and open the PR.

### Example 6
User says: "Ship these tiny hotfix follow-ups" after versions `0.1.2`, `0.1.3`, and `0.1.4` were used for quick corrections.
Expected behavior:
1. Use a squashed/range changelog entry instead of noisy one-line sections for each tiny patch:
   ```markdown
   ## 0.1.2-0.1.4

   - Fixed startup when optional config was missing.
   - Corrected the package entrypoint for npm installs.
   - Repaired the lockfile after the hotfix publish.
   ```
2. Keep bullets factual and terse.
3. Do not add an `Unreleased` section unless the repo's own instructions require it.

### Example 7
User asks to open a PR in an npm package repo with no changelog.
Expected behavior:
1. Check whether a changelog-style workflow exists under another name, such as `RELEASES.md` or per-package changelogs.
2. If none exists and a changelog would be useful, create `CHANGELOG.md` retrospectively from available npm release data.
3. Prefer reliable source material:
   - `npm view <package-name> versions --json`
   - git tags matching published versions
   - GitHub releases, if present
   - existing package metadata or release commits
4. Keep old entries brief when details are sparse:
   ```markdown
   # Changelog

   ## 0.3.0

   - Added the current PR's user-visible behavior.

   ## 0.1.0-0.2.9

   - Bumped core runtime dependencies across the early package releases.
   - Aligned package metadata and entrypoints with the supported SDK versions.
   - Fixed install and startup regressions found during initial npm publishing.
   ```
5. Do not fabricate detailed historical bullets when release data does not support them.
