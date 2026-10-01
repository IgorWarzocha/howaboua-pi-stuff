Review each topic against its actual parent and inspect its complete coherent commit range. Review the private cumulative preview for integration, intended package set, direct changesets and release effects. Do not repeat already-reviewed package line review for a policy-only topology correction.

Require the local graph and remote PR bases to agree. Confirm independent topics are siblings, the collector excludes unmerged payload, child diffs are non-empty, and no artificial native stack or queued merge remains. Check parent and child bodies against actual collection status.

Use one independent read-only review for new policy and topology. Fix concrete in-scope findings, then run one cumulative `bun run check:changed` and `bun run changeset:check` gate from the committed private preview. Do not run focused checks immediately before a gate that repeats them. CI owns aggregate changesets.

Before branch-diff gates, require colocated Git `HEAD` to equal the committed private preview. When JJ `@` is the octopus preview itself, Git `HEAD` points to its first parent. Use an empty working child with `jj new <private-preview>`, then assert `test "$(git rev-parse HEAD)" = "$(git rev-parse <private-preview>)"` so package selection cannot silently use only the first parent.

Record the reviewed candidate tree. For a topology-only correction, prove package payload and lockfile match the previously reviewed tree byte-for-byte, with only authorized repo guidance differing. Report private preview validation as preview evidence, not as checks run on the unassembled collector.

Request bot review only when explicitly asked or required. Review the assembled collector's release scope and tree preservation before landing without duplicating focused line review.
