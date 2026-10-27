Merges to main feed Changesets versioning and npm publishing.

Every package must work against released upstream Pi. Never make monorepo functionality depend on modifying, patching or forking upstream Pi; use supported extension APIs and report unavailable capabilities honestly.

We use this toolkit. If tools fail or cause friction, propose concrete fixes. Apply tiny, low-risk fixes without derailing the task. Edit owning source, never installed tooling. Validate and report changes. Source edits do not update running packages.
Sandbox validation means interacting with Pi's TUI through Herdr: normal consecutive turns that execute tools and use the guest environment. Programmatic probes do not require a sandbox and do not substitute for this interaction.
For live TUI review, use `bun run sandbox:setup --name NAME --live-model openai-codex/MODEL` after candidate changes. Reuse the host login through this setup's scoped access-token sync; a functioning authenticated guest is the baseline. Stop active review agents before replacing the guest snapshot; host edits alone never update it. Fix guest readiness instead of moving TUI acceptance onto the host.
Release acceptance must run the candidate's bundled native helpers without overrides. Verify guest compatibility first and replace incompatible disposable guests rather than rebuilding helpers around them.
Resolve package names against immediate packages subdirectories. Search the unique word match first, then follow direct references.
Keep pi-codex-web-run and pi-codex-imagegen src/codex-runtime trees identical. Do not publish a shared runtime package.

Agent-facing text is behaviour. Keep contracts, skills, prompt metadata and subagent prompts compact. Default to general-purpose assistance. Scope coding assumptions to coding tasks.
Hide extension internals from agent-facing text, including errors. State what happened, what remains available and an actionable next step. Users own account and configuration decisions. Success may expose a new action, not invented workflow advice.
Keep the static prefix small and stable. Defer nonessential tools through Code/Notebook while preserving discovery. Deliver tool guidance on demand through supported mid-session messages or results, not prefix edits.
Tool activation changes the live catalogue and chronological notices, not the standing system prompt. Rebuild tool-derived standing instructions from current state only at session/window rollover.
Mid-session harness updates use chronological developer messages where supported, Pi custom messages otherwise. Custom messages (`pi.sendMessage`, `customType`, `display`) are extension-labelled UI/history entries converted to provider user messages; purple-box styling does not make them system-role messages. Never substitute Pi system updates: its unsupported-provider fallback folds them into the initial prompt and breaks prefix stability.
Extend existing tools, not overlapping choices. Help-backed tools default to no-argument discovery, {} in structured mode. Keep explicit help visible and disclose current arguments on demand. Preserve familiar contracts. Omit obvious field descriptions.
Do not repeat obvious contracts across names, descriptions, schemas, promptSnippet and promptGuidelines. Use the latter two only for concrete failures. Never rewrite prior tool calls or results to integrate a tool.
Measure emitted tool schemas and system-prompt deltas for cache impact. Repository AGENTS.md is internal guidance, not product prompt cost.
Prefer semantic signal over grammatical polish. Drop cosmetic punctuation only if syntax, delimiters, meaning, evidence, caveats and recovery survive.
GPT-mode prose uses checkpoint-style fragments, arrows and terse clauses. Measure tokens: keep spaces when joined words cost more; compression must not increase tokens. Preserve syntax, caveats, recovery and normal-mode prose.
Skills and extensions must work for any user. Never ship personal names, local paths, machine assumptions or private workflows.

Delete permanent tests by default. Retain only consequential failure coverage that static checks and disposable probes cannot adequately provide. Contract labels do not justify retention. Add permanent tests only when the user explicitly requests more coverage.
If agents misuse tools or ignore prompts, fix the model-facing contract from real-use evidence, not programmatic tests. Tests may cover deterministic parser, executor, result and routing boundaries.
Put editing hazards and fragile ownership/order constraints in the nearest AGENTS.md, not regression suites. Distil constraints, not inventories of deleted assertions. Keep runtime validation in owning code.
Review supported workflows: who triggers the failure, and how does execution reach it? A synthetic reproducer or possible interleaving alone does not prove exposure.
Weigh consequence and exposure against fix complexity. Rare severe failures may warrant fixes. Hypotheticals alone do not justify coordination, recovery or compatibility machinery.
Respect product tradeoffs. Optional capabilities are not defects. Do not inflate severity with unsupported worst cases. If a review questions scope, cull first.

Trace each kickoff through the complete before_agent_start chain before prompt/tool rewrites and prewarm. Pi 1.2 prepares user and idle custom-message starts, not in-run steering. Preparation is busy; tree navigation must finish before kickoff. Never substitute captured-prompt patches for other extensions' preparation.
Code/Notebook nested tools sit outside provider JSON schemas. Callable tools do not prove their prompt contracts survived. Verify final instructions and native schemas separately.
Slash commands are for users, tools for agents. Prefer one routed entry command unless explicitly asked for several.

Amend only tiny, immediate, behaviour-preserving corrections to the latest unpublished commit. Put behaviour changes, revised approaches and later fixes in new commits.
Release related session work together: one PR or an atomically merged stack, not serial cleanup releases.
If published behaviour or payload changes, keep exactly one changeset per changed extension, one extension per file. Describe only that extension's changes. Dependency-only changes, ordinary docs and tests need none.
Changesets describe net user-facing differences from the last published version, not the PR's commit history. Read recent package changelogs; write short, direct entries with one outcome per bullet and breaking changes and required migrations first. Omit implementation detail, repeated explanations and fixes to regressions introduced within the same release. Never write "upcoming release", "unreleased" or speculative notes.
Work on dev in the existing checkout by default. Parallel work may use task branches in worktrees. Other branches require Igor's explicit request. Check the branch before editing. Before new work on dev, check whether its previous dev → main PR merged. If yes, align dev with main after verifying that all dev work is published. Preserve dirty files and unpublished commits even if alignment blocks. Never merge main into dev.
While editing, use focused package checks. bun run check:changed selects committed branch changes, not working edits. Prefer bun changeset -- "summary". Use bun changeset:raw only for intentional non-patch bumps.
Before pushing updates to an open PR, read new review comments, including bots, and address concrete in-scope findings. Review new comments generated by the push afterward.
After behaviour-preserving module splits, run bun refactor:compare --base <pre-refactor> --entry <old path> --probe <ESM>. Probe old and replacement modules with identical inputs, assert normalised outputs and explain every reachable old-side path. Coverage is traversal, not proof. Retain probes only for durable independent contracts.
Never manually bump aggregate versions or add their changesets. CI runs bun run changeset:aggregates.
