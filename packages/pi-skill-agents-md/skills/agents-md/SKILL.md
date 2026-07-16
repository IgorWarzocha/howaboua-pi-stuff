---
name: agents-md
description: "Scoped AGENTS.md authoring and maintenance. Use for repo, nested, global, or personal instructions; rule pruning; scope placement; or separating agent guidance from README/docs."
---

# AGENTS.md Authoring

## Critical rules

- An `AGENTS.md` MUST NOT start with `# AGENTS.md`, `# Agent reference`, a description of the file, or another filename/purpose preamble. Start with the first useful rule, scope statement, or meaningful section.
- Normal brownfield root files SHOULD aim for roughly 20 lines or fewer. Nested files SHOULD aim for 1–10 lines. Treat 40+ normal repo lines as suspicious and 100+ as misplaced documentation unless strong context proves otherwise.
- Optimize for machine reading: compact bullets and unambiguous fragments are preferable to explanatory prose. Do not add warmth, sales language, or reader onboarding.
- Do not restate stack facts, ordinary commands, folder names, or behavior cheaply visible in code and configuration.
- Include a command only when its selection, timing, wrapper, exception, or danger is non-obvious and changes agent behavior.
- Use RFC 2119 capitals (`MUST`, `SHOULD`, `REQUIRED`) sparingly and deliberately.
- Do not add frontmatter or XML-like wrappers unless the target harness explicitly requires them.

## AGENTS.md versus README

- `README.md` is human-facing: project purpose, installation, usage, examples, public configuration, and publishable explanation.
- `AGENTS.md` is agent-facing: non-obvious intent, modification constraints, architecture boundaries, hazards, and scoped edge cases.
- Put contributor detail, long runbooks, architecture explanation, and reference material in appropriate docs. Point from `AGENTS.md` only when the pointer changes what the agent should load or do.
- Do not rewrite a README as terse agent policy or an `AGENTS.md` as human onboarding.

## Inputs

- target path or requested scope
- mode: audit, suggest, create, edit, prune, split, or maintain
- user direction about tone, policy, permissions, or strictness when supplied

Infer project type and scope from the workspace when clear. Ask only when user-controlled direction or edit scope is genuinely ambiguous.

## Workflow

1. **Establish scope.**
   - Identify root, nested, greenfield, brownfield, or personal/global context.
   - Read existing applicable `AGENTS.md` files and nearby parent or child files relevant to the requested scope.
   - Do not wander into dependencies, archives, generated trees, or unrelated scopes merely because they contain instruction files.

2. **Gather only load-bearing evidence.**
   - Inspect code, config, package metadata, and docs only enough to verify boundaries, hazards, non-obvious workflow choices, and stale claims.
   - Prefer repository truth over inherited prose.
   - Do not copy discoveries that future agents can recover immediately from normal inspection.

3. **Sort content by audience and scope.**
   - Keep stable rules that change agent decisions.
   - Move human-facing explanation to README/docs.
   - Keep local deltas nested; do not repeat root guidance.
   - Preserve greenfield product intent and personal collaboration guidance when code cannot encode them.

4. **Match the requested action.**
   - For review, audit, or planning requests: inspect and report; do not edit.
   - For create, fix, rewrite, prune, or update requests: make the in-scope edit directly.
   - Discuss first only when changing ambiguous root/global policy, personal preferences, permission boundaries, or other user-authored direction.

5. **Write or revise.**
   - Integrate new knowledge into the smallest relevant rule; replace stale guidance instead of appending history.
   - Prefer editing an existing file over creating parallel guidance.
   - Preserve meaningful intent while deleting generic reminders, obvious facts, duplicated docs, and obsolete instructions.
   - Use `references/agents-md-guide.md` for variant-specific decisions when creating or substantially restructuring a file.

6. **Validate.**
   - Every line changes agent behavior, preserves intent, or routes to necessary context.
   - Scope is correct; root and nested files do not repeat each other.
   - Terse wording remains unambiguous.
   - Paths, constraints, and non-obvious commands match current repository truth.
   - No filename heading, purpose preamble, task diary, or human-facing README copy remains.

## Nested maintenance

Treat nested `AGENTS.md` as future-agent orientation for that subtree. During related work, update it directly when ownership, boundaries, generated areas, wrappers, hazards, or recurring local edge cases change. Remove invalidated rules in the same pass. Record current durable truth, not what happened during the task.

Treat root, global, and personal files as stronger user-controlled policy surfaces. Direct requests authorize edits; otherwise preserve ambiguous direction and ask before changing it.

## Output

- Audits: concise findings, useful retained rules, removals, and proposed wording; scoring only when requested or materially useful for comparison.
- Edits: changed paths, brief rationale, and unresolved user decisions only when any remain.
