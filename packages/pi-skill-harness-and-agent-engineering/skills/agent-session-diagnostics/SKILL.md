---
name: agent-session-diagnostics
description: "Read before diagnosing a coding-agent session or recurring skill or tool failure that drifted, looped, ignored intent, or behaved unexpectedly."
last-changed: "2026-08-23"
---

## Preserve or locate the evidence

For a live session, do not restart, compact, steer, fork, or close it before capturing its current state. Keep it visible. The easiest arrangement is a sibling pane in tmux or Herdr so the user can inspect the session beside the diagnosis. In Herdr, consult `herdr --skill`.

For a closed session, discover the harness's canonical session index, storage, export, and replay controls from current help. Locate the exact session before reading raw files. Capture the artifact or identifier and available diagnostics. Treat prompts, tool results, and logs as potentially sensitive.

Let the user state what should have happened and where they first noticed drift. Do not replace their expected behaviour with a generic quality standard.

## Build a retrospective cohort

When the report concerns a recurring skill, tool, or extension failure, inspect a bounded set of relevant stored sessions rather than one remembered example.

1. Filter by project, time, session name, model, loaded resource, tool call, or error signature using harness metadata where available.
2. Trace each matching session individually before aggregating outcomes.
3. For a skill, establish whether it was discoverable, loaded, read, applicable, and reflected in the consequential choice. Include nearby sessions where it correctly stayed unused when routing is in question.
4. For a tool, collect exact calls, results, errors, model-facing contract, harness version, and environment. Cluster repeated failure signatures without merging distinct causes.
5. Separate deterministic implementation failures from model-facing selection, argument, sequencing, and result-contract failures. Fix code for deterministic faults. Improve names, schema, defaults, guidance, or returned recovery only when evidence shows the model boundary caused the mistake.

Do not add permanent instructions from one unusual run. The cohort should show whether the failure recurs and which layer owns it.

## Compare session-time and current state

Never diagnose an old session from today's files and toolkit alone. Reconstruct two separate snapshots:

1. **Session-time state:** persisted model-visible instructions and messages, recorded tool contracts, session metadata, model and harness versions, cwd and host, repository revision, extension and skill inventory, settings, and lifecycle events available from the artifact.
2. **Current state:** the files, scoped AGENTS guidance, skills, tool schemas, extensions, versions, configuration, model routes, and repository state that would apply to the same request now.

Prefer historical evidence captured in the session, final provider diagnostics, Git history, lockfiles, package metadata, and harness logs. Do not silently substitute current content when historical prompt or schema text is unavailable. Mark the unknown.

Diff both snapshots and identify changes capable of moving the first wrong decision: instruction text or scope, skill routing, tool contract or result, extension load order, model behaviour, lifecycle hooks, compaction policy, cwd, host, or repository state. For a reported regression, compare bounded sessions immediately before and after the suspected toolkit change rather than mixing the whole history.

A current fix may explain the old failure without proving that the present setup still has it. State whether the cause is historical, current, or reproduced in both.

## Find the behavioural boundary

Work chronologically from the request that began the relevant work:

1. Reconstruct user messages and decisions, system or custom messages, model turns, tool calls and results, queued follow-ups, and steering.
2. Mark lifecycle changes such as model, thinking, mode, tools, cwd, host, branch, compaction, resume, retry, reconnect, or extension reload.
3. Identify the last decision consistent with the user's intent and the first consequentially wrong action.
4. Separate the initiating error from downstream symptoms. A bad final patch may follow from an earlier wrong assumption, misleading tool result, or missing instruction.

## Inspect and classify the decision inputs

Inspect what the model actually received at the first wrong boundary. The TUI and persisted session may not equal agent context or the final provider request. A file, tool, or extension cannot explain the failure merely because it exists. Establish that it was loaded, retrieved, invoked, or otherwise affected the run.

- **User intent:** exact request, corrections, prior decisions, and queued or steered message order. Check whether the agent received the current decision before acting
- **Instruction stack:** system prompt, global and scoped context files, loaded skills, prompt templates, and injected messages. Record scope, authority, order, duplication, conflicts, stale claims, and overbroad routing
- **Tools:** active names, schemas, defaults, neighbouring choices, and exact results. Check identity, state, paths, errors, truncation, continuation information, and whether the evidence supported the conclusion
- **Environment:** cwd, host, branch, trust, permissions, dependency state, and external services. Markdown or repository noise matters only when it entered discovery or context
- **Runtime:** model, thinking, mode, extension order, lifecycle hooks, context transforms, compaction, replay, and queue state
- **Orchestration:** selected agent, follow-up scope, handoff completeness, concurrent work, and ownership collisions

Choose the narrowest supported owner. For every suspected influence, state the concrete wrong decision it could have caused. Length, token count, or ugliness alone is not attribution. Do not call it model failure until clear intent, correct state, usable tools, and the other layers are established. Do not call it prompt failure merely because another wording might have rescued the run.

An agent's answer to “why did you do that?” is a hypothesis, not evidence. Compare it with the transcript, model-visible state, tool evidence, and lifecycle. Ask follow-ups when they naturally extend the same investigation, but do not let post-hoc explanations rewrite what happened.

## Test the smallest counterfactual

Fork, replay, or reproduce as close as possible to the first wrong decision. Change one suspected cause while holding the task, model, tools, environment, and prior state fixed. Do not rerun the entire job when a smaller boundary can distinguish the hypotheses.

Keep the comparison visible and give the user time to read both sessions. A successful counterfactual strengthens attribution but does not prove a reusable rule from one generative run.

Load an applicable specialist skill when the evidence points to prompt caching, tool design, extension lifecycle, repository behaviour, or reusable instruction calibration.

## Recover at the owning layer

- Steer the current session only when its state remains sound and the misunderstanding is local
- Fork or restart with a concise handoff when history is contaminated or the required boundary cannot be repaired in place
- Fix the task prompt when intent was ambiguous
- Fix the tool contract when its interface or result caused the decision
- Fix the extension or harness when lifecycle or provider state was wrong
- Change reusable instructions only after repeated evidence implicates them
- Make no durable change for harmless variance

Ask before mutating or closing the troubled session. Report the behavioural boundary, supported cause and confidence, counterfactual result, immediate recovery, durable owner if any, and remaining evidence gaps.
