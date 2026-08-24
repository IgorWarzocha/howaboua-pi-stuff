---
name: scratchpad
description: "Read before putting experimental or disposable work that should survive the session into the persistent scratchpad."
last-changed: "2026-08-22"
---

Use the scratchpad when work needs persistent files but does not belong in a maintained repository:

- experiments and reproductions
- model, agent, or tool comparisons
- generated prototypes and sample projects
- benchmark runs and result sets
- temporary implementations or disposable checkouts worth retaining
- investigations without a proper project home

Do not create one for a tiny command probe, normal repository work, or files that already have a durable owner.

1. Choose one short, descriptive kebab-case name. Try RS uses it verbatim and adds no date prefix.
2. Create or enter it with:

   ```bash
   eval "$(try-rs <name>)"
   pwd
   ```

3. Keep one top-level scratchpad per coherent effort. Create ordinary subdirectories inside it for variants, fixtures, captures, or results.
4. Use `try-rs <git-url> [destination]` when the scratch work begins from a disposable checkout.
5. Do not use Try RS worktree mode.
6. Keep useful outputs. Add notes only when they help preserve what was run or learned.
7. Report the scratchpad path and important outputs when finished.
