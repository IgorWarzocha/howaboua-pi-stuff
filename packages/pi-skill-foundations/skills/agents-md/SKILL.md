---
name: agents-md
description: "Use when creating, auditing, or revising an AGENTS.md file."
last-changed: "2026-09-05"
---

1. Use governing guidance already in context; do not reread it. Inspect the target's applicable guidance only where coverage is missing or uncertain. Verify the active harness's loading rules when scope depends on them. Inspect only enough code or configuration to verify proposed guidance.
2. Establish whether the target is an ordinary brownfield root, a nested subtree, greenfield product guidance, or personal and global policy.
3. Put each rule in its nearest durable home.
   - Prefer code, configuration, or an executable check when it can enforce the rule.
   - Keep human-facing explanation in README or appropriate documentation.
   - Use `AGENTS.md` for non-obvious intent, constraints, hazards, ownership boundaries, and pointers that change what an agent should load or do.
   - Create a nested file only for a genuine local delta: subtree ownership, public API or import boundaries, generated or frozen areas, required wrappers or local tools, placement traps, subtree-only skills or documentation, and recurring mistakes an agent cannot cheaply infer.
   - Create a justified nested file even when the current Codex session will not load it automatically. It remains durable hive context for Pi and agents that start or work in that subtree.
   - Do not use nested files for task history, implementation summaries, directory tours, or repeated ancestor guidance.
4. Start the target file with its first useful rule or scope statement. Address the reading agent as you. Do not add a filename heading, purpose preamble, frontmatter, or wrapper unless the target harness requires it.
5. Match the register to the scope.
   - Ordinary brownfield roots and nested files use compact, machine-first bullets or unambiguous fragments.
   - Personal and global files, including personal agent repositories, may use first-person prose, humour, metaphor, and distinctive voice when the language carries identity, relationship, taste, autonomy, permission boundaries, or collaboration style.
   - Greenfield guidance may preserve expressive founder language when it controls product decisions that code cannot yet encode.
   - Keep expressive passages specific and decision-bearing. Remove generic inspiration, performed personality, and decorative flourishes that change nothing.
6. Do not inventory the stack, source tree, package scripts, routine commands, task history, or behaviour cheaply visible in code and configuration. Include a command only when its selection, timing, wrapper, exception, or danger changes agent behaviour.
7. Preserve user-authored intent and local terminology. When deletion could weaken ambiguous root, global, or personal policy, keep it or ask rather than silently deciding.
8. Verify paths, commands, ownership, tool names, and claimed conventions locally. Do not promote guesses, one-off observations, or current-task details into standing rules.
9. Aim ordinary brownfield roots at roughly 20 lines and nested files at 1 to 10. Treat more than 40 ordinary repo lines as suspicious and more than 100 as misplaced documentation unless strong context proves otherwise. Allow longer greenfield and personal files when they carry durable intent unavailable elsewhere.
10. Write a lean and mean, opinionated delta to a competent agent's defaults, not an authoring manual. Retain non-obvious local judgment, durable user intent, and corrections grounded in observed failures. A merely plausible benefit does not earn a rule.
