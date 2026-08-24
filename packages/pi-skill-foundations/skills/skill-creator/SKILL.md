---
name: skill-creator
description: "Read before creating or revising a reusable agent skill."
last-changed: "2026-08-23"
---

1. For revisions, read the existing `SKILL.md` and every file it directly loads before changing structure or removing material.
2. Check the available skills before drafting. Read any whose guidance materially applies to the domain, artifact, or writing mode of the skill being authored.
3. Choose the package scope before drafting. A global skill must apply across workspaces in the user's environment. It may be specialist, but must not assume one repository's paths, packages, commands, versions, provider payloads, or internal lifecycle. Distill project evidence into portable decisions, invariants, and failure modes. Keep project mechanics in a project-scoped skill or guidance. A project skill may be a delta-only addendum: give it a distinct name, tell the agent to discover and load an applicable general skill, then state only local constraints, exceptions, paths, and completion. A project skill with the same name as a global skill shadows it, so use that name only for an intentional complete replacement. Check the global catalog before naming. Do not copy or hard-code the global package.
4. Ground the work in two or three real requests, observed failures, or explicit user corrections. Identify the decision, failure, or quality bar the skill must change.
5. Write the description as the shortest reliable call trigger, not a summary of the package.
   - Address the reading agent as you at selection time. Say when to read the skill or what behaviour now applies.
   - Prefer direct forms such as `Read before...`, `Use for...`, or `Must always apply.`
   - Do not describe what the skill offers, improves, helps with, or contains.
   - Add only the boundary needed to avoid the nearest real collision.
   - Keep package contents, routes, examples, and rationale in the body.
   - Do not pad with prompt synonyms or capability inventory.
   - Quote it. Aim for 175 characters or fewer. Characters 176 through 200 require justification. More than 200 is an error.
6. Start every skill and reference body inside execution. Do not add a title, filename heading, purpose, activation, or other preamble that repeats its trigger or route.
7. Keep the normal path and judgment needed on every run in `SKILL.md`. Put branch-specific detail behind exact reference paths. Use scripts only where deterministic code is simpler and more reliable than prose.
8. When one skill needs another capability, tell its reader to discover and load an available applicable skill for that capability. Never hard-code another package's name because skill inventories differ between environments. Name it as a skill, for example `load an applicable review skill`, not `load code-review` or `use "code review"`.
9. Keep a line only when it changes a decision, prevents a known failure, preserves user-authored intent, or defines observable completion. Remove model defaults, host guarantees, generic encouragement, duplicate checks, and facts cheaply recovered from the environment.
10. Match the body's register to how language affects execution.
   - Operational, coding, tooling, review, and SOP skills use terse instructions, explicit conditions, exact checks, and observable boundaries.
   - Creative, voice, taste, and ideation skills may use evocative, opinionated, or playful language when that language directly steers the output. Their call triggers remain direct and terse.
11. For revisions, preserve verified domain judgment and useful failure handling. Replace stale or conflicting guidance instead of appending history.
12. Exercise bundled scripts and verify every referenced path. Review call and near-collision requests only when the trigger changed materially or an observed selection failure warrants it. Do not build synthetic suites that merely prove the skill exists.
