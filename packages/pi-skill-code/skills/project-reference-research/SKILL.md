---
name: project-reference-research
description: "Read before investigating a project the user mentions."
last-changed: "2026-08-22"
---

- Resolve the project's canonical upstream repository first. Verify remotes, not directory names, and ask when its identity or ownership is ambiguous.
- `~/Work` holds the user's own working projects. Place or reuse those checkouts there exactly as they are. Do not pull, switch, reset, clean, stash, or otherwise disturb them unless the user separately asks.
- `~/Frameworks` holds third-party repositories used only as disposable, read-only references. Verify the canonical upstream, clone if absent, and update to the latest upstream version before research. If local state blocks a clean update, discard it or recreate the checkout.
