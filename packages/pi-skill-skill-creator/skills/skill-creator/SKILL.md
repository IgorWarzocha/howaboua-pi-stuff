---
name: skill-creator
description: "Designs, writes, refactors, and packages agent skills. Use for new skills, SKILL.md improvements, trigger descriptions, references/scripts splits, examples, validation, or porting workflows. Not for one-off prompt tweaks, strict runbooks, or vague workflows."
---

# Skill Creator

## Purpose

Use this skill to build or improve reusable skills for a workspace without turning them into bloated promptware. A good skill should trigger cleanly, stay operational, keep its frontmatter lean, and match the target workspace style: act first when the path is clear, keep warmth where it helps, and troubleshoot only when reality actually breaks.

## Inputs expected

### Required

- The workflow or problem the skill should handle.
- The target skill path or enough context to infer it.

### Optional

- Existing `SKILL.md` to improve.
- Reference docs, example prompts, or upstream skills to adapt.
- Whether the skill should stay minimal or include `references/` / `scripts/`.

## Prerequisites

- Read `references/skills-reference-guide-for-agents.md` before authoring or heavily restructuring a skill.
- Prefer exact paths and existing workspace conventions over invented structure.

## Workflow

1. **Confirm the task deserves a skill.**
   - A skill is warranted when the workflow recurs, has recognizable steps, and output quality improves when structure is reused.
   - If the workflow is still mushy, tighten the use cases before writing anything.

2. **Map the real trigger boundary.**
   - Define what the skill does, when it should load, and when it should stay quiet.
   - Write the description from user intent, not internal architecture.
   - Add negative scope when over-triggering is likely.

3. **Design the smallest shape that will work.**
   - Default to one `SKILL.md`.
   - Add `references/` only when detailed material would bloat the main file.
   - Add `scripts/` only when deterministic validation or transformation is genuinely better in code.
   - Do not add folders just to look sophisticated.

4. **Draft the frontmatter last, but keep it lean.**
   - Default to only `name` and `description` unless extra fields are truly justified.
   - Keep the description trigger-rich and compact.
   - Quote `description` by default; unquoted YAML breaks on `: `, brackets, braces, and other plain-scalar traps.
   - Put all trigger guidance in the frontmatter `description`: what the skill does, when to use it, and when not to use it if overlap is likely.
   - Do not add `When to use`, `Do not use when`, `Activation`, `Triggers`, or similar trigger-boundary sections to the skill body. By the time the body is loaded, the agent should already know why this skill applies; if not, the `description` is wrong and must be improved.
   - Avoid architecture-centred or product-marketing wording.

5. **Write the operational body.**
   - Include the core job, boundaries, expected inputs, workflow, validation, error handling, output contract, and a few realistic examples.
   - Keep body boundaries operational: prerequisites, safety limits, handoff rules, and workflow constraints are fine; trigger-selection guidance belongs in frontmatter only.
   - Keep the step order explicit.
   - Put critical rules near the top.
   - Prefer exact file paths when pointing to supporting material.

6. **Bake in workspace style deliberately.**
   - Assume availability first; do the normal thing before opening a troubleshooting box.
   - Troubleshooting commands belong in a separate reference when possible, and should be read only when failure actually appears.
   - If the path is clear and low-risk, act first instead of over-asking.
   - Ask before destructive or high-blast-radius changes.
   - Match the target workspace tone: warm when collaboration benefits, crisp when procedure matters.

7. **When trigger quality feels off, correct it by feel first.**
   - If a user says a skill does not trigger well enough, assume the description is too vague, too timid, or missing the actual user phrasing.
   - Tighten or broaden the `description` using the way users naturally ask for the thing.
   - Add negative scope if the skill is barging in where it should stay quiet.
   - Do not default to elaborate eval harnesses or benchmark theater unless the user explicitly wants that.
   - Make the trigger sentence sharper, then let real use tell us if it still misses.

8. **Validate the skill against the guide and the target workspace.**
   - Trigger boundary is clear.
   - Frontmatter is slim.
   - Frontmatter YAML parses cleanly; quote `description`, especially when it contains `: `.
   - Workflow is ordered.
   - References are exact and only loaded when needed.
   - It does not turn every task into diagnostics-first ritual.
   - It does not become doctrine when a bounded tool would do.

9. **Run the required efficiency pass after every create/update.**
   - Run `python scripts/skill-efficiency-check.py <skill-dir-or-SKILL.md>` from this skill directory for every skill touched, or use the equivalent packaged script path if the skill is installed elsewhere.
   - Read the report as a prompt-budget and workspace-style check, not as an automatic rewrite engine.
   - Fix hard issues before shipping: invalid frontmatter, missing `name` / `description`, non-kebab name, forbidden trigger-selection body sections, or descriptions above the failure threshold.
   - Treat warnings as judgement calls: long but necessary descriptions may stay, but first try to preserve trigger nouns while cutting filler.
   - Keep the useful `skill-cleaner` posture: measure model-visible cost, suggest before deleting, and prefer compact descriptions. Do not copy its generic auto-suggested action labels blindly.

10. **Ship the skill cleanly.**
   - Create or update the files directly when the target path and intent are obvious.
   - Include the efficiency pass result in the final summary when a skill was created or changed.
   - Summarize what was created or changed and why.
   - If useful, call out the trigger sentence so it is easy to sanity-check.

## Validation

- The skill solves a recurring workflow, not a one-off.
- The description states what it does, when to use it, and when not to use it if overlap is likely.
- Frontmatter is not bloated.
- Frontmatter YAML parses cleanly; quote `description`, especially when it contains `: `.
- The body does not contain `When to use`, `Do not use when`, or equivalent trigger-selection sections.
- `SKILL.md` stays operational; heavy detail is moved out.
- The required efficiency pass has run after every skill create/update, and hard issues are fixed before shipping.
- The workflow does the normal thing first and troubleshoots only on pain.
- If trigger quality was the complaint, the description was adjusted directly instead of disappearing into evaluation machinery.
- Examples are concrete enough to teach the shape.
- File paths in references are exact.

## Error handling

### Error: workflow is too vague

Action: reduce it to 2-3 concrete use cases before drafting the skill.

### Error: over-triggering or under-triggering risk

Action: tighten or broaden the description with explicit examples and exclusions.

### Error: main file is getting bloated

Action: move factual detail or edge cases into `references/`.

### Error: deterministic check is too fuzzy in prose

Action: move that check into `scripts/` only if the repeatable logic really benefits from code.

### Error: copied external skill is preachy or tool-religious

Action: keep the useful workflow, delete the doctrine.

## Output contract

A completed skill-creation pass should leave:

- a valid `SKILL.md` in the right folder
- any needed `references/` or `scripts/` files
- a clear trigger description
- explicit boundaries and workflow
- a passing efficiency check, or a clearly explained warning that was intentionally left
- a concise summary of what changed and why

## Examples

### Example 1

User says: "Make me a skill for turning recurring repo spelunking into a reusable workflow."

Expected behaviour:

1. Confirm the workflow is recurring.
2. Read the skills guide.
3. Draft a minimal skill with a sharp trigger boundary.
4. Add references only if the main file starts getting fat.

### Example 2

User says: "This skill is too robotic and keeps running diagnostics first. Fix it."

Expected behaviour:

1. Read the existing skill.
2. Identify the diagnostics-first smell.
3. Split troubleshooting into a separate reference if needed.
4. Rework the default workflow so it tries the normal path first.

### Example 3

User says: "Port this upstream skill, but make it fit this workspace."

Expected behaviour:

1. Extract the real workflow from the upstream material.
2. Keep the useful patterns.
3. Remove doctrinal, bloated, or tool-religious framing.
4. Rebuild it with the workspace trigger style, boundaries, and operating posture.
5. Run the efficiency pass and fix any hard issues before reporting back.
