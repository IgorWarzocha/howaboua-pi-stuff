This repo publishes through Changesets; every merge to `main` feeds the version and npm publish workflow.

- Resolve package names by matching their words against immediate subdirectories of packages; search the unique match first and follow direct references only.
- Keep the vendored `src/codex-runtime` trees in pi-codex-web-run and pi-codex-imagegen identical; do not publish a shared runtime package.
- Agent-facing text is behavior: keep tool contracts, skill files, prompt metadata, and subagent prompts compact.
- Measure package-emitted tool schemas and system-prompt deltas for cache impact; repository `AGENTS.md` is internal, not product prompt cost.
- Do not repeat self-evident contracts across names, descriptions, schemas, `promptSnippet`, or `promptGuidelines`; use the latter two only for concrete failures. Never rewrite prior tool calls/results to integrate a tool.
- Agent-facing prose need not perform grammatical polish; optimize semantic signal per token and omit cosmetic punctuation when it saves tokens. Preserve syntax, structural delimiters, meaning, evidence, caveats, and recovery instructions.
- Contract spine, not feature museum: feature-existence and regression-tour tests die; retain only independent protocol, routing, migration, or model-visible contracts.
- When review questions test scope, cull first: delete whole cases or narrow to the minimum independent contract. Never increase permanent test count unless the user explicitly requests more coverage.
- Never encode agent tool-call mistakes or prompt-following failures as programmatic tests. Discover them in real use and fix the model-facing contract; tests may cover only deterministic parser, executor, result, or routing boundaries independently of model compliance.
- Skills and extensions must work for any user. Never ship local paths, personal names, machine assumptions, or private workflow details.
- Slash commands are for users; agents use tools. Prefer one routed entry command over several command names unless explicitly requested.
- Treat related package work from one session as one release unit: one PR or one directly, atomically merged stack. Installed users should not absorb serial cleanup releases.
- Shipped package changes require a changeset. Use concrete release language; never write “upcoming release”, “unreleased”, or speculative notes.
- Changeset bodies become changelog copy: lead with one concise outcome; for broad releases add short user-facing capability bullets. Never dump implementation, tests, review history, or a multi-feature release into one prose lump.
- Before a `dev` → `main` PR, fetch/prune, reset `dev` onto `origin/main`, then cherry-pick only intended commits. Never merge `main` into `dev`.
- Prefer `bun run check:changed` and patch-autodetecting `bun changeset -- "summary"`; use `bun changeset:raw` only for intentional non-patch bumps.
- After behavior-preserving module splits, run `bun refactor:compare --base <pre-refactor> --entry <old path> --probe <ESM>`; the probe calls old and replacement modules with identical inputs, asserts normalized outputs, and expands until no reachable old-side paths remain unexplained. Coverage is traversal, not proof; retain probes only for durable independent contracts.
- Do not bump aggregate package versions or add their changesets manually; CI runs `bun run changeset:aggregates`.
