# Review a stack

Use this phase to audit each focused PR, dispatch local reviewers, request GitHub bot reviews, triage
findings, and converge fixes without turning the stack into one aggregate diff.

## Establish review boundaries

Refresh native state and record every selected layer's PR number, head SHA, and direct parent SHA:

```bash
gh stack view --json
gh pr view <pr> --json number,title,body,baseRefName,headRefName,headRefOid,state,reviews,statusCheckRollup
```

A focused PR is `parent head..layer head`, never `trunk..top`. If a reviewer tool scopes a supplied
base against the current checkout, check out the intended PR head and pass its direct parent. The
reviewer does not switch branches. Aggregate review is a separate explicit request.

## Audit with the user

When walking the release together, inspect one PR at a time in the user's chosen order; use top to
bottom when deciding what can be removed before final landing. For each layer:

1. Read its issue, PR body, comments, exact direct-base diff, and owning implementation paths.
2. State its goal, changed line/file count, and whether the implementation actually solves the
   reported or intended problem.
3. Separate required behavior from unrelated work, speculative hardening, and over-engineering.
4. Run the test cull below.
5. Record the verdict and agreed edit, then continue. After the pass, repair owning layers bottom to
   top and cascade once. Do not bury unresolved product choices in mechanical cleanup.

Keep explanations concrete and short. Do not repeat stack mechanics the user already understands.

## Cull tests

Inspect every added or changed test with deletion as the default. The full gate is
`../../gh-issue-pr-flow/SKILL.md#verification-cull`. Keep only a minimal independent contract spine
for plausible future faults: protocol parsing or serialization, hazardous routing or isolation,
persisted migration, or another stable boundary with an oracle independent of the implementation.

Delete complete feature tours, presentation and copy locks, replica duplicates, setting-exists cases,
and tests that merely prove a feature currently works. A fake provider cannot prove provider-dependent
model semantics. A mocked external event bus or library cannot prove that extension integration works;
exercise simple extensions in action instead. Do not replace deleted theatre with new cases unless the
user explicitly asks for more permanent coverage.

After deletion, remove fixtures, helpers, and exports that existed only for tests. Report complete test
cases deleted separately from assertions or sub-scenarios removed; assertion cleanup is not a test
cull.

## Dispatch local reviewers

Assign one distinct PR to each agent unless the user explicitly requests overlapping coverage. Give
each assignment the exact head, direct base, PR goal, and any narrow risk focus. Agents are read-only
unless a separate fix task is requested.

Let reviewers finish. Triage their findings yourself before involving the user: reproduce plausible
faults, trace real product reachability, reject theoretical lifecycle states that cannot occur, and
collapse duplicates. Fix mechanical owner-layer faults directly. Ask only for the few findings that
require a product or scope decision; never dump raw reviewer bookkeeping into a large disposition
form.

## Request bot reviews

Finalize PR titles, bodies, bases, order, and heads first. Post one request to each selected focused PR,
bottom to top. The standard body, configured commenter account, and exact token-only command are owned
by `../../gh-issue-pr-flow/SKILL.md#codex-review`; never switch the active `gh` account merely to
comment.

Do not repost after routine pushes. If the user explicitly requests a fresh pass after a completed
repair cascade, verify every selected head and post once to each selected PR. Give the bot a useful
interval before checking; do not poll constantly.

Triage bot findings against the current code and owning layer, not the stale reviewed SHA alone. Reply
to each thread with the fix or dismissal evidence, resolve settled threads, then apply owner-layer
fixes and cascade once. Revalidate the complete stack after review converges; approval and merge belong
to `merge.md`.
