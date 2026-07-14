# @howaboua/pi-skill-gh-issue-pr-flow

Runs an opinionated GitHub workflow with `gh`: issues, branches, commits, pushes, PR creation and updates, release hygiene, review requests, and feedback triage.

## Install

```bash
pi install npm:@howaboua/pi-skill-gh-issue-pr-flow
```

Use it as a portable fallback. Repository instructions and explicit user direction take precedence.

The skill checks branch and worktree state before history operations, keeps unrelated changes out of PRs, avoids unsafe force pushes, and reads its release-hygiene reference when package work is meant to ship.
