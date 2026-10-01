Use one ordinary PR unless focused review benefits from separate topics. For split releases, keep these roles:

```text
<batch>/umbrella       parent collector PR, base main
<topic>/<name>         focused PRs, base collector for independent topics
<private-preview>     local JJ merge of topic heads, no remote ref or PR
main                  final release target
```

Verify the active GitHub contributor, JJ commit identity, clean or understood edits, existing refs and PRs before writes. Use the existing JJ checkout. Do not retrofit JJ into a shared Git checkout or create Git worktrees.

Fetch first. Create the collector on `main@origin` with any repo-only guidance, then create each independent topic from that collector. Keep implementation, direct changeset and follow-up fixes together without flattening traceable fixes. Genuine dependencies may target another topic, but review convenience alone is not a dependency.

Push named collector and topic bookmarks through JJ's remote-state checks. Open the parent against `main` and topics against the collector branch. Do not run `gh stack link` for siblings. Each topic body links `Part of #<parent-pr>` and states its own scope, dependencies and validation. The parent lists child links, collection status and release effects.

Require every topic range to be described, conflict-free, non-empty and limited to its concern. Verify actual remote heads and bases, not just local bookmarks. Create a local multi-parent JJ preview from all topic heads for cumulative inspection. Keep that preview private and out of the collector until collection is authorized.
