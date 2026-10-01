Fetch and inspect JJ status, workspaces, graph, remote heads and PR bases before changing history. Stop on unexpected remote movement or another writer's work. Use JJ leases, never plain force pushes or local `gh-stack` adoption.

Edit the owning topic and preserve meaningful fix commits. An ancestor correction rebases descendants, so resolve conflicts and recheck affected direct-parent diffs before pushing. Independent topics must remain siblings rooted at the collector.

For a correction from an artificial linear chain:

1. Record current PR numbers, heads, native membership, queue and auto-merge state, topic commit boundaries and reviewed cumulative tree.
2. Build the collector on `main` with repo guidance only. Rebase each topic's own coherent range onto it, retaining direct changesets and fixes, not inherited unrelated payload.
3. Build a private sibling-merge preview. Resolve integration conflicts without changing reviewed package bytes when this is a topology-only correction.
4. Remove artificial native membership with `gh stack unstack <number>`. Queued or auto-merge members can remain stacked. Verify complete removal before retargeting, and stop if any remain.
5. Push only named collector and topic bookmarks with JJ leases. Retarget existing topic PRs to the collector only after its copied topic payload is gone. Preserve PR numbers and update bodies to remove stale ordering and assembly claims.
6. Verify remote refs, each non-empty topic diff, collector scope, sibling ancestry and private preview payload. Delete an obsolete staging ref only when it is unused and its removal is authorized.

Rebuild the private preview after topic changes. Never move the collector to the preview just to show a cumulative diff. Parallel reviewers stay read-only. Any parallel implementation must own independent candidate revisions, not published ancestors and descendants.
