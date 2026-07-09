# AGENTS.md decision guide

Consult the sections relevant to the target. Do not reproduce this guide inside an `AGENTS.md`.

## Content destination

Use `AGENTS.md` for information an agent needs while modifying the scoped workspace:

- non-obvious project direction or current migration state
- constraints agents are likely to violate
- architecture and ownership seams not enforced by code
- generated, frozen, security-sensitive, or destructive areas
- surprising command selection, wrappers, exceptions, or validation behavior
- local edge cases and context-routing pointers
- personal collaboration and permission boundaries in global files

Use `README.md` for humans evaluating or using the project:

- what the project does and why it exists
- installation and normal usage
- user-facing examples and configuration
- public behavior, screenshots, and support links

Use contributor or architecture docs for detailed implementation explanation, routine development workflows, long runbooks, schemas, and design rationale. Prefer a short decision rule over copying those documents into `AGENTS.md`.

## Length and phrasing

- Nested local file: 1–10 lines.
- Normal brownfield root: aim for roughly 20 lines or fewer.
- Greenfield founder note: longer only while it carries product intent unavailable elsewhere.
- Personal/global file: longer when it carries relationship, memory, and operating style.
- Over 40 normal repo lines: scrutinize aggressively.
- Over 100 lines: usually documentation, a runbook, duplicated scopes, or accumulated history.

Compress semantics, not precision:

- delete facts visible in ordinary inspection
- replace prose with direct bullets or unambiguous fragments
- replace “be careful” with the forbidden action or failure condition
- replace copied documentation with a pointer plus the reason to load it
- move subtree-only rules into the nearest useful nested file
- remove headings that merely repeat the filename or announce the document's purpose

## Brownfield root

Keep only project-wide, non-obvious deltas. Typical material:

- current direction not encoded in code
- genuine non-negotiables agents repeatedly violate
- architecture seams agents are likely to bypass
- surprising verification exceptions
- routing to nested instructions or conditional specialist docs

Do not inventory the stack, package scripts, source tree, or standard development cycle.

Shape:

```md
- <Current non-obvious direction or migration state>.
- <MUST/SHOULD constraint agents are likely to violate>.
- <Architecture seam: use X; do not bypass Y>.
- <Verification exception or dangerous command condition>.
- <Load nested instruction or specialist document when condition>.
```

## Nested subtree

Create a nested file when a subtree has durable local guidance that would pollute the root or be missed by future agents. Useful subjects:

- folder ownership and responsibility
- public API or import boundary
- generated, vendored, frozen, or platform-specific areas
- required wrappers and local tool paths
- placement traps such as “do not put X here”
- a specialist document or skill needed only for this subtree

Shape:

```md
- Owns <specific local responsibility>.
- Public access goes through <path/import/API>.
- Keep <changes/imports> inside <boundary>.
- Do not place or edit <local trap>.
- Load <skill/doc> before <specific work>.
```

Maintain nested files during related work. Update stable facts directly, replace invalidated rules, and avoid chronological notes, temporary status, issue-specific breadcrumbs, or implementation summaries.

## Greenfield

Early projects may need concise prose because mission, taste, anti-goals, and product direction do not yet exist in code. Preserve founder language when it controls decisions; remove generic startup inspiration.

Useful material:

- what the product should become
- what “good” should feel like
- current optimization target and explicit non-goals
- premature abstractions or integrations to avoid
- starting constraints not yet represented in code

Do not force a mature brownfield checklist onto an early idea, but keep every paragraph decision-bearing.

## Personal or global

Global files may carry communication style, autonomy, permission boundaries, memory locations, collaboration preferences, and identity. They are allowed more structure and prose because much of this context has no repository source of truth.

Keep personal material out of published repositories. Do not copy global preferences into each project unless the project intentionally overrides them.

## Update decisions

Edit directly when:

- the user requested an `AGENTS.md` change
- an in-scope nested rule became stale during related work
- a stable local edge case or boundary was discovered and future agents would not infer it cheaply
- a file move, generator, wrapper, or ownership change invalidated existing guidance

Discuss first when:

- root/global product direction is ambiguous
- a personal preference or permission boundary would change
- pruning may erase intentional user-authored context whose current value cannot be verified
- several valid scope placements encode meaningfully different policies

Do not append merely because something happened once. Prefer tooling, code structure, or documentation when they can make the bad state impossible or the fact cheaply discoverable.
