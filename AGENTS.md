This repo publishes through Changesets; every merge to `main` feeds the version and npm publish workflow.

- Resolve package names by matching their words against immediate subdirectories of packages; search the unique match first and follow direct references only.
- Agent-facing text is behavior: keep tool contracts, skill files, prompt metadata, and subagent prompts compact.
- Agent-facing prose need not perform grammatical polish; optimize semantic signal per token and omit cosmetic punctuation when it saves tokens. Preserve syntax, structural delimiters, meaning, evidence, caveats, and recovery instructions.
- Contract spine, not feature museum: feature-existence and regression-tour tests die; retain only independent protocol, routing, migration, or model-visible contracts.
- Never encode agent tool-call mistakes or prompt-following failures as programmatic tests. Discover them in real use and fix the model-facing contract; tests may cover only deterministic parser, executor, result, or routing boundaries independently of model compliance.
- Skills and extensions must work for any user. Never ship local paths, personal names, machine assumptions, or private workflow details.
- Slash commands are for users; agents use tools. Prefer one routed entry command over several command names unless explicitly requested.
- Treat related package work from one session as one release unit: one PR or one directly, atomically merged stack. Installed users should not absorb serial cleanup releases.
- Shipped package changes require a changeset. Use concrete release language; never write “upcoming release”, “unreleased”, or speculative notes.
- Before a `dev` → `main` PR, fetch/prune, reset `dev` onto `origin/main`, then cherry-pick only intended commits. Never merge `main` into `dev`.
- Prefer `bun run check:changed` and patch-autodetecting `bun changeset -- "summary"`; use `bun changeset:raw` only for intentional non-patch bumps.
- Do not bump aggregate package versions or add their changesets manually; CI runs `bun run changeset:aggregates`.
