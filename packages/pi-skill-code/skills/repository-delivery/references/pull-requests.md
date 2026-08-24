## Choose topology

- One ordinary pull request: one coherent release unit or no review benefit from slicing.
- Separate ordinary pull requests: independently reviewable and shippable work.
- Dependent stack: separately reviewable ordered layers with dependencies.
- Stack plus umbrella: focused layers form one release unit and must not land separately. Root the stack on staging. Target the release branch only from the cumulative umbrella.

For stacked work, load an applicable stacked pull request workflow skill before changing history or remote topology. Keep one local history owner. Prefer JJ when suitable. Require local revision order and remote pull request order to agree.

Each focused layer owns one concern and its direct-parent diff. The umbrella owns cumulative integration, release context, and final validation. Keep it at the cumulative top. Stack assembly and umbrella landing require separate explicit authorization. After assembly, move the umbrella to the assembled result and rerun cumulative checks and review.

## Submit or update

1. Open pull requests ready for review. Never create draft pull requests.
2. Use a focused branch unless the current branch already owns the work. Move materially separate work elsewhere.
3. For maintained code, load an applicable codebase hygiene skill while implementing and an applicable review skill before submission.
4. Run focused checks while editing. Run the relevant aggregate gate once after convergence.
5. Review the complete diff and commit range against the target. Confirm intended files and commits, requested behavior, repository standards, understandable scope, and accurate title, body, and validation.
6. Prefer one coherent concern. Keep coupled concerns together only when splitting creates an unsafe partial state, artificial dependency, or misleading history. Explain the coupling.

## Review feedback

Read every current comment and verify it against the request, repository rules, and implementation. Fix valid required findings and useful in-scope recommendations. Reject false findings, defer separate work, and avoid optional churn. Recheck the full submission after edits. Report what was fixed, rejected, or deferred and why.

## History safety

- Fetch before repairing or publishing history.
- Never use plain `--force`. Use `--force-with-lease` only on your own branch when clearly safe.
- On a rejected push, inspect divergence before rebasing, merging, resetting, or pushing with lease.
- Never rewrite published shared history.

## Write the pull request

Write from the final diff and decisions. A reviewer must be able to tell why it exists, what behavior changes, where judgment is needed, and what evidence supports it. Rewrite prose that sounds synthetic or could fit another pull request after swapping nouns.

Optional style shortcuts:

- **Daniel Stenberg:** trigger, failure mechanism, correction, stop.
- **David Tolnay:** lead with unusual review risk or manual exceptions, then reproducible proof.
- **Simon Willison:** concrete examples, observed evidence, honest uncertainty.
- **Lukasz Langa:** old and new API use, compatibility effects, reviewable trade-off.

Mix, choose, or ignore them. Never mention the style prompt.

Title: specific, searchable final effect. Follow repository prefixes and grammar. Avoid branch names, issue numbers alone, version numbers alone when a descriptive release title is available, and vague wording such as `Fix cache bug`. Prefer `Preserve live response continuation during cache refresh`.

Body: lead with the most useful fact. Include only needed reason, net behavior, non-obvious decisions, risks, trade-offs, review focus, exact validation results, issue linkage, and release effects. Do not default to `This PR...`, paraphrase the diff in balanced bullets, list commands without outcomes, invent certainty, or retain empty template sections. Small work may need one paragraph. Complex work may need headings.

Focused layer: state the direct-parent change, dependency, and stack position. Umbrella: state the cumulative outcome, list focused pull requests with one-line purposes, give aggregate validation and release effects, and identify the landing role. Do not duplicate focused descriptions.

Before publishing or updating, compare title and body with the final diff. Correct stale scope, evidence, links, risks, and review focus. Use `Closes #123` only for full resolution and `Refs #123` otherwise. Pass multiline Markdown with `--body-file`.

## Codex review

Request only when the user asks or repository instructions require it. Do not repost after routine updates. Use:

```text
@codex please review this PR and give me 10-20 issues if any. Categorize findings as required, recommended, or optional.
```

## Release and finish

Follow the repository's release system. Create only expected artifacts. Never invent version bumps, changelog history, or funding metadata. Ask when release intent is unclear.

Return links for changed GitHub artifacts. Report material result, validation, branch or pull request state, deferred risk, and the reason for any skipped expected check.
