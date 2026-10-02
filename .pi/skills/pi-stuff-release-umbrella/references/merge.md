Collecting topics into the parent and landing the parent on `main` are separate actions. Neither is authorized by preparing or correcting the topology. Do not use native stack assembly for independent siblings.

Before authorized collection, record the reviewed private preview tree. Require selected topic PRs to be open, ready, green, approved by eligible reviewers and free of unresolved required threads. Merge only the authorized children into the collector, never directly into `main`. Keep collection status in the parent body accurate.

After collection, fetch into JJ and compare the assembled collector tree with the reviewed preview. A mismatch blocks landing until explained and validated. Verify no intended child payload or direct changeset is missing, and no unrelated payload was added.

Only separate explicit authorization permits merging the collector PR to `main`. Require the actual assembled head, current required checks, fresh eligible approval and resolved required threads. The collector is the sole release landing PR.

Verify the final merged tree and release target. Remove topic, collector and private preview refs only when authorized or required by repository policy. Never describe queued PRs as merged.
