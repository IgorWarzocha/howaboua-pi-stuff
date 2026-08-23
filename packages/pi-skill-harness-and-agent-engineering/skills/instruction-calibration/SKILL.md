---
name: instruction-calibration
description: "Read before empirically tuning a reusable skill or agent prompt."
last-changed: "2026-08-23"
---

For reusable skill structure, also load an applicable skill-authoring skill. This skill owns behavioural calibration, not package shape.

## Define the delta

1. Start from a real request, observed failure, or explicit correction.
2. State the behaviour that should change and what must remain unchanged.
3. Prepare a small probe set:
   - the natural request that exposed the failure
   - the nearest request that should produce a different choice
   - an unrelated request where the instruction should stay out of the way
4. Give test agents only the task and context they cannot access. Do not hide the desired method inside the probe.

## Keep the user in the comparison

- The easiest setup is tmux or Herdr, with each tested agent in a visible sibling pane beside the current session. Preserve the current workspace, working directory, and user focus unless the comparison requires another environment. In Herdr, consult `herdr --skill`.
- Do not hide calibration in a background subagent or detached process.
- Inspect the tested coding agent's current help for controls over context files, reusable instructions, skills, plugins, and extensions. Start with the fewest local instruction layers, state anything that cannot be disabled, then restore layers progressively.
- For Pi, `pi -nc -ns -ne` is the local raw starting point. Use current help to add only the candidate skill or prompt before restoring the natural environment.
- After each meaningful run, identify the pane, prompt, and loaded instruction layers, give only an initial observation or suggested next probe, then stop for the user to read both sessions.
- Do not revise the candidate, decide the disposition, or close test runs before the user responds. Leave every pane open until the user permits cleanup.
- Allow natural follow-up prompts in the same test session, including asking the model to diagnose or improve its answer. Treat them as exploration, not fresh baseline evidence.
- After changing a loaded skill, prompt, context file, or environment layer, use the harness reload path only for a WIP check. Relaunch a fresh session for comparison evidence. Keep superseded runs visible but exclude them from clean comparisons.

## Isolate the instruction

1. Keep the model, thinking level, tools, working directory, task, and available context fixed.
2. Run a clean baseline without the candidate instruction.
3. Run the same probe in a fresh session with the candidate skill or prompt.
4. Change no tool schema, runtime policy, profile, or task framing during the comparison. Test session reuse separately only when reuse is the behaviour under study.

## Read behaviour, not prose

- Compare choices, actions, omissions, and useful output. A polished answer is not proof of better behaviour.
- Expect variance. Ignore wording, structure, and harmless judgment drift that does not change correctness, a consequential choice, or usefulness. Do not tune toward identical outputs.
- Separate model defaults, task ambiguity, missing context, local policy, and instruction effects.
- Treat one unusually good or bad run as weak evidence. Cull Captain Obvious guidance only when the native baseline reliably supplies the same behaviour across realistic probes.
- Preserve local policy and unavailable context even when the model could guess them.
- If both runs fail because the task is underspecified, repair the task prompt rather than bloating a reusable skill.
- Treat new ceremony, eager routing, overgeneralisation, or regressions on the negative probe as instruction failures.

## Tune the boundary

- Change one coherent instruction at a time.
- Write the smallest direct condition, action, or boundary that addresses the observed failure.
- Prefer familiar words and natural task framing. Add an example only when the wording remains ambiguous.
- Do not teach a specialist its own discipline. Supply the concrete task, inaccessible context, and local decisions.
- Remove rationale once the operative instruction stands on its own.

## Verify and cull

Rerun the same probes in fresh sessions. Repeat only when the disposition depends on whether a consequential choice is stable. Do not chase ordinary generative drift.

After behaviour converges, compress the candidate and rerun the closest collision. For every retained line, name the plausible regression its removal restores. Delete the line when no concrete answer survives.

Finish with the baseline behaviour, observed delta, final instruction change, and any unresolved variance.
