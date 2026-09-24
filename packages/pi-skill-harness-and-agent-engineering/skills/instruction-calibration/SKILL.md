---
name: instruction-calibration
description: "Read before empirically tuning a reusable skill or agent prompt."
last-changed: "2026-09-24"
---

For reusable skill structure, also load an applicable skill-authoring skill.

## Define the comparison

- Start with a real request, observed failure, or durable correction. Name the consequential choice to change and what must stay unchanged.
- Use the natural request, its closest decision boundary, and an unrelated non-use case. Do not put the desired solution into the task.
- Separate remembered knowledge from productive performance. A closed-book probe can expose stale assumptions, but the working baseline should have the docs and source normally available. Verify generated work against the active API and execute relevant checks. Plausible output is not correctness.

## Control the layers

- Inspect current harness help. Start with few local instruction layers, record what remains, then restore docs access, repository context, and skills deliberately. These discovery runs are not isolated instruction comparisons when several variables change.
- For Pi, `pi -nc -ns -ne` disables discovery, not an agent's ability to read instruction files. Inspect actual reads and loaded prompt layers. Exclude contaminated baselines or restrict instruction-file access equally in both arms.
- Compare fresh sessions with identical model, reasoning, tools, cwd, task, and available files. Change only the candidate instruction. Keep follow-ups and reloads for exploration, not clean baseline evidence.
- Test the one-shot output before coaching. Do not credit corrections from a follow-up to the original instruction.
- Finish with the normal worker environment to check skill selection and conflicting layers. Treat that as integration evidence, not an isolated comparison.

## Run with the agreed supervision

Use visible sibling sessions when available, preserving cwd and user focus. Consult current harness controls rather than embedding launch recipes. Keep only active comparisons open.

For an interactive comparison, let each meaningful run finish and pause for the user to inspect it before changing the candidate. When the user delegates evaluation, run, judge, refine, and clean up autonomously. Report evidence at completion instead of requiring approval between probes. Human UX preference still needs the user's judgment.

## Tune and verify

- Judge choices, actions, omissions, and useful output, not polish or identical wording. Separate instruction effects from model defaults, missing context, ambiguity, and local policy.
- One unusually good or bad run is weak evidence. Repeat when disposition depends on stability, not to eliminate harmless variance. Repair underspecified tasks instead of enlarging reusable guidance.
- Change one coherent boundary. Prefer the smallest condition and action. Keep inaccessible facts and local decisions. Do not teach a specialist its own discipline. Add examples only to resolve demonstrated ambiguity.
- Rerun the same probes after compression, especially the closest collision. Reject new ceremony, eager routing, or regressions on non-use. For each retained line, identify the concrete failure its removal restores. Otherwise cull it.

Finish with the baseline, observed delta, active API verification, token change, final instruction change, and unresolved variance. Do not turn model-compliance probes into permanent programmatic tests.
