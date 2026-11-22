---
name: project-reference-research
description: "Read before researching a project as a reference for ideas, comparisons, or claim verification."
last-changed: "2026-11-22"
---

- For installed-software diagnosis, inspect the installed version rather than substituting a fresh upstream checkout.
- Resolve the canonical upstream first. Verify remotes, not directory names. Ask only if unresolved identity affects the research.
- Preserve working checkouts. Use a known reference checkout or make a disposable clone in an appropriate workspace. Verify the revision against the claim: use the relevant tag or commit for a version-specific question and current upstream for current behaviour. If local changes interfere, inspect a clean revision separately rather than discarding them.
- Read reference source without modifying it, installing dependencies, or building in the checkout.
