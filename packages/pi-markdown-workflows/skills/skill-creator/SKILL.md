---
name: skill-creator
description: "Reusable skill design and maintenance. Use for SKILL.md creation, trigger design, body structure, supporting files, validation, consolidation, or cross-agent ports. Not for one-off prompt edits or passive documentation."
---

# Skill Creator

## Inputs

Required:

- the workflow or recurring problem the skill should handle
- the target path, or enough workspace context to infer it

Useful when available:

- an existing skill and all of its supporting files
- representative user requests, failures, or corrections
- host documentation and nearby skill conventions

## Reference guide

Read `references/skills-reference-guide-for-agents.md` before creating a skill or substantially restructuring one. For a narrow edit, use its reading map and consult only the relevant sections.

## Workflow

1. **Ground the task.**
   - Read the existing `SKILL.md` and every file it directs the agent to read before deleting, merging, or restructuring anything.
   - Verify host format rules, real tool names, commands, paths, and workspace conventions instead of preserving plausible-sounding assumptions.
   - Identify two or three concrete requests the skill should handle.

2. **Decide whether a skill is the right artifact.**
   - Use a skill for a recurring task where reusable instructions, judgment, examples, or helpers improve execution.
   - Use ordinary documentation for passive reference material with no repeatable agent workflow.
   - A tool runbook can be a skill when its commands, failure handling, or result interpretation change agent behavior. A rigid project procedure may belong in the workspace's workflow or SOP system instead.

3. **Set the trigger boundary.**
   - Treat the description as a semantic index: job, activation conditions, likely request language, key artifacts/outcomes, and only necessary exclusions.
   - Compress for reliable model selection. Dense phrases beat explanatory sentences.
   - No mood, rationale, promotion, or tutorial prose. Creative skills do not get creative descriptions.
   - Prefer the shortest description that preserves reliable triggering.
   - Quote the description by default so YAML punctuation cannot change its meaning.

4. **Choose the smallest complete structure.**
   - Keep the core workflow and load-bearing judgment in `SKILL.md`.
   - Use `references/` for detailed guidance, domain knowledge, extended examples, or edge cases that are not needed on every run.
   - Use `scripts/` for deterministic validation or transformation that is more reliable as code.
   - Use `assets/` for templates or static inputs consumed by the workflow.
   - Do not create supporting folders without useful content, but actively consider whether each would make the skill more complete or dependable.

5. **Write the operational body.**
   - Do not add `Purpose`, `When to use`, `Activation`, `Triggers`, or equivalent restatements. The description owns job and selection semantics.
   - For SOP, coding, tooling, and review skills, use terse commands, decisions, constraints, and observable checks. Fragments are fine.
   - For creative skills, the body may use evocative language when tone changes generation quality. Descriptions remain denotative and terse.
   - Provide the ordered workflow and critical constraints.
   - Consider inputs, prerequisites, validation, error handling, output contract, and examples; include each when it changes behavior or removes meaningful ambiguity.
   - State important autonomy, approval, and safety boundaries once, near the action they govern.
   - Prefer observable instructions—commands, conditions, paths, thresholds, outputs, or forbidden actions—over generic quality reminders.
   - Keep examples sparse and distinct. Each should teach a decision or edge case rather than restate the workflow.

6. **Preserve useful knowledge without preserving accumulation.**
   - Keep verified domain judgment and hard-won failure handling, including material that helps weaker or context-poor models.
   - Remove duplicated guidance, unexplained references to other skills, model-specific folklore, and instructions the host already guarantees.
   - Keep the skill self-contained. Do not require another skill to understand this one.

7. **Validate behavior and packaging.**
   - Run `python scripts/skill-efficiency-check.py <skill-dir-or-SKILL.md>` from this skill directory, or use its installed path.
   - Treat failures as structural problems and warnings or suggestions as review prompts, not automatic rewrite orders.
   - Check supporting paths, exercise bundled scripts, and use the host's own skill validation when available.
   - Review a few representative trigger and non-trigger requests when the description changed materially. Build a larger evaluation only when repeated real failures justify it.

8. **Finish the change.**
   - Make in-scope, low-risk edits directly when intent and target are clear.
   - Ask before destructive changes, external writes, or a material expansion of scope.
   - Report changed files, validation performed, and any intentional warning or tradeoff.

## Validation checklist

- The skill teaches a recurring workflow rather than merely naming a topic.
- The description fully carries the job, activation conditions, and necessary boundaries.
- The body contains judgment and procedure that materially guide execution.
- Body register fits the task: terse for operational skills; evocative only where creative generation benefits.
- Supporting files are useful, local, and loaded at the right time.
- Required host constraints and runtime assumptions are accurate.
- Generic quality prose and repeated examples have been removed before useful detail.
- The lightweight efficiency check and relevant host/package checks pass.

## Recovery

- **Workflow is vague:** reduce it to concrete requests, inputs, decisions, and results before drafting.
- **Triggering is unreliable:** revise the description using real user language and adjacent non-trigger cases.
- **Description is flowery:** replace voice and explanation with job, trigger, artifact, and outcome terms.
- **Body repeats the description:** delete the restatement and begin with operational content.
- **Body is unwieldy:** separate conditional detail into references, then remove repetition rather than merely moving it.
- **Many skills overlap:** compare their real workflows; merge fake separations and keep distinct jobs separate.
- **A deterministic rule remains fuzzy:** encode it in a script when doing so is simpler and more reliable than prose.
- **Upstream material is bloated or doctrinal:** retain verified workflow knowledge and rebuild the instructions around the target host and users.

## Output

A completed pass leaves a valid, packaged skill; useful supporting files where warranted; a reliable trigger description; and a concise record of validation and intentional tradeoffs.
