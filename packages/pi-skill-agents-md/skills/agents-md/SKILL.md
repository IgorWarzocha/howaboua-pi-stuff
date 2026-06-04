---
name: agents-md
description: How to write, audit and edit AGENTS.md files.
---

# AGENTS.md Authoring

## Purpose

Create and improve AGENTS.md files that are short, scoped, and useful to coding agents. Preserve intent and non-obvious rules; do not summarize the repo.

## Critical rules

- Suggest changes before editing; discuss first unless the user explicitly asks for direct edits.
- Normal repo/brownfield AGENTS.md should aim for ~20 lines or less.
- Do not restate what an agent can infer from code, package files, folder names, or a quick search.
- Prefer compressed, high-signal half-sentences over full prose, except for greenfield/founder notes and personal/global files.
- Nested AGENTS.md files should mostly contain local edge cases, local pointers, or skill/doc routing.
- Use RFC2119 caps (`MUST`, `SHOULD`, `REQUIRED`) sparingly for true non-negotiables.
- Do not use XML-ish wrappers by default.

## Inputs expected

- Target path or repo/folder scope.
- Desired mode: audit, suggest, draft, rewrite, split, or create missing root guidance.
- Project type when known: greenfield, brownfield, nested, or personal/global.
- User intent, preferences, or comments about tone/strictness.

If the target or project type is unclear, inspect briefly and infer. Ask only when the edit direction or blast radius is ambiguous.

## Workflow

1. **Scope the work.**
   - Identify whether the target is repo-level, nested, greenfield, brownfield, or personal/global.
   - Stay inside the user-requested scope. Do not wander into unrelated dependencies or archives just because they contain AGENTS.md.

2. **Inspect only what matters.**
   - Read existing AGENTS.md files in scope and nearest parent/child scopes when relevant.
   - Read README/package/Cargo/build files only enough to find non-obvious commands, boundaries, and hazards.
   - Use targeted search for repeated patterns instead of copying repo documentation.

3. **Classify useful content.**
   - Keep rules that change agent behaviour.
   - Drop generic language, obvious stack summaries, motivational filler, duplicated docs, and stale boilerplate.
   - Preserve founder/product intent when the project is greenfield and the code cannot express it yet.

4. **Suggest before editing.**
   - Present proposed changes as a short list or compact draft.
   - Explain what will be removed, kept, or added.
   - Wait for user direction unless the user already asked for direct edits.

5. **Edit if approved or explicitly requested.**
   - Prefer editing existing AGENTS.md over creating duplicates.
   - For nested files, write only the local delta.
   - For bloated files, compress first; suggest splitting runbook/spec material into docs only when needed.

6. **Validate the result.**
   - Scoped, short, non-verbose, actionable.
   - No duplication of obvious codebase facts.
   - Root and nested files do not repeat each other.

## Variant guidance

### Repo-level brownfield

Include only non-obvious deltas:

- direction not encoded in code
- non-negotiables agents might violate
- verification exceptions, not obvious package scripts
- architecture seams agents are likely to bypass
- nested AGENTS / skill / doc routing

Template:

```md
# AGENTS.md

- <Non-obvious project direction or current migration state>.
- <MUST/SHOULD non-negotiable agents are likely to violate>.
- <Verification exception: command, when to run, or what not to run>.
- <Architecture seam: use X, do not bypass Y>.
- <Nested AGENTS / skill / doc routing if relevant>.
```

### Nested folder

Use for local edge cases:

- folder ownership
- import/public API boundary
- generated/frozen/stable area rules
- platform/tool wrappers
- “do not put X here” traps
- “load X skill/doc first” pointers

Template:

```md
# <Folder/module> rules

- This folder owns <specific responsibility>.
- Public access goes through <path/import/API>.
- Keep internal imports/changes inside <boundary>.
- Do not put <wrong concern> here.
- Load/read <skill/doc> before changing <area>.
```

### Greenfield

Can be prose. A founder/developer braindump is valid when it carries mission, product taste, anti-goals, and direction that the codebase cannot contain yet. Generic corporate inspiration is not useful.

Template:

```md
# AGENTS.md

This project is early. <Mission / product taste / what this should become>.

- Optimize for <goal> over <non-goal>.
- Avoid <premature complexity> until repeated patterns appear.
- <What “good” feels like>.
- <What not to waste time on yet>.
- <Known starting paths, if any>.
```

### Personal/global

Can be longer. It may include communication style, permission boundaries, memory, collaboration preferences, and identity. Do not copy personal guidance into project repos.

Template:

```md
# Personal agent guidance

## Communication
- <How to answer this user.>

## Workflow
- <How to plan, ask, commit, finish.>

## Boundaries
- <What requires explicit approval.>

## Memory / continuity
- <What to remember and where.>
```

## Length defaults

- Nested local file: 1–10 lines.
- Normal repo/brownfield root: up to ~20 lines.
- Greenfield/founder note: may be longer if it carries product intent.
- Personal/global file: may be longer if it carries relationship and operating style.
- Over ~40 lines for a normal repo: suspicious; trim hard.
- Over ~100 lines: probably docs/spec/runbook content.

## Compression moves

- Delete stack facts already visible in package/config files.
- Replace paragraphs with direct bullets.
- Replace “always be careful” with the specific forbidden action.
- Replace copied docs with a pointer plus the decision rule.
- Move local edge cases into nested AGENTS.md.
- Keep RFC2119 caps only for true non-negotiables.

## Scoring rubric

Score out of 20:

1. Local specificity / 5 — unique to this repo/folder/person.
2. Actionability / 5 — commands, paths, boundaries, forbidden moves, or clear intent.
3. Non-verbosity / 4 — compact rules; no prose unless prose carries intent.
4. Source-of-truth hygiene / 3 — links or points instead of duplicating docs/code.
5. Scope fit / 3 — repo, nested, greenfield, brownfield, or personal style matches the file.

## Output contract

For audits or suggestions, return:

- score or quality signal
- what to keep
- what to remove/compress
- proposed replacement or bullet-level diff
- questions only where user intent is genuinely needed

For edits, return:

- changed path(s)
- brief summary of what changed
- any follow-up decisions left to the user
