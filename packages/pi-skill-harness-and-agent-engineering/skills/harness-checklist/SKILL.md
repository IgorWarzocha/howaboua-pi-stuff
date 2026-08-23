---
name: harness-checklist
description: "Read before auditing a coding-agent harness environment and recommending improvements."
last-changed: "2026-08-23"
---

Perform a read-only audit. Establish what the harness provides natively before assessing its surrounding environment. Do not count native capabilities as additions or recommend rebuilding them by default. Judge capabilities, not package names. Do not install, remove, edit, enable, or reconfigure anything during the audit.

## Establish the audit

1. Ask where the complete harness working set lives. Accept a monorepo, assembly directory, or maintained copy folder containing extensions, skills, context files, tools, profiles, configuration, and user interfaces. If none exists, record the limitation and recommend one. Do not assemble it without a separate request.
2. Reconcile three views: capabilities native to the current harness, the exact user and agent toolkit exposed in this session, and additions present in the working set. Inspect current help, active tools and skills, commands and UI, loaders, settings, and model-visible context. Mark capabilities as native, active from the working set, active from another source, available but inactive, generated, obsolete, or absent. A folder does not prove exposure, while one session does not prove the complete available setup.
3. Run a fresh visible session with the effective setup and one trivial first turn such as `Reply only with hi`. Record provider-reported prompt input and inspect the session, active tools, instructions, startup messages, and other model-visible surface. When the harness can safely disable optional layers, repeat with the same model, reasoning, working directory, and prompt as a native baseline. Treat the difference as permanent startup overhead, not a quality score.
4. Ask what feels wrong and what the user expected instead. Record the affected workflow.
5. Ask for representative project folders or overlays for each stated kind of work. Do not call a capability missing until checking its work-specific layer. If the base permanently loads one domain's surface, consider a project folder, launch profile, or overlay.
6. Ask what the agent may do silently, report afterward, ask before doing, or hand back. Map this per workflow rather than choosing one autonomy level.
7. Compare that contract with instructions, approvals, tool restrictions, extension behaviour, notifications, and recovery controls. Flag unwanted ceremony and invisible automation.
8. Trace global and scoped context, skills, extension prompts, tool guidance, and templates through their real load paths. Find conflicts, duplication, shadowing, misplaced scope, and double-loaded behaviour.
9. Group extensions, tools, skills, CLIs, scripts, slash commands, and host behaviour by job and audience. Identify one behavioural owner. Prefer a CLI or CLI plus skill when hooks, state, UI, or tool registration add nothing.

For every later check, credit a working capability regardless of whether it is native, configured globally, project-scoped, or exposed only in the current session. Recommend an addition only for a remaining gap.

When a gate requires deeper instruction, tool, extension, cache, or session analysis, load an applicable specialist skill at that gate. Use it only for analysis. Do not implement its remediation procedure during this audit.

## Audit guidance coverage

Inspect skill triggers and bodies, not names or counts.

- Check for lean guidance on creating, calibrating, and pruning skills when agents maintain the environment.
- Check for guidance on scoping agent instruction files, separating them from user docs, assigning narrow ownership, and removing stale rules.
- Derive other needs from the user's workflows. Check guidance for tool and extension design, prompt or cache changes, session diagnosis, and any recurring work with local standards.
- Classify each skill as global or work-specific. Flag globally discoverable skills whose triggers, paths, commands, examples, or policy apply only to one repository or maintained overlay. Recommend moving the package into that scope or splitting a reusable core from local guidance. Keep a niche skill global when it applies across workspaces and the user wants it discoverable there.
- Check global and project skill names for collisions. Confirm that same-name project skills intentionally replace the global package and that delta-only addenda use distinct names.
- For each expected behaviour, verify discoverability, scope, audience, one owner, absence of conflicting surfaces, applicable use, nearby non-use, and a real decision changed.
- Classify each skill as stable or living. Stable skills change when their owned contract or evidence changes. A living skill for user calibration, evolving workflows, or recurring lessons must explicitly authorize the agent to revise it when durable feedback exposes a gap, contradiction, or stale rule. Revision should rewrite the package coherently rather than append a correction log.
- Recommend keeping, trimming, merging, moving, replacing, or removing current guidance before adding more.

Recommend a new skill only for a repeated or consequential decision the model cannot infer and no current surface owns. Otherwise recommend scoped context, a task prompt, tool contract or result, CLI help, extension behaviour, or a user control.

## Nested agent instructions

Assess whether the environment has a cache-safe way to load nested `AGENTS.md` files as work enters narrower repository scope. Guidance should arrive before dependent decisions, inject once, and preserve the stable prompt and earlier provider history. Check the complete extension set, not isolation alone.

## Assess workflow fit

For each major workflow, check:

1. **Material:** access to required files, services, data, applications, and rendered state
2. **Judgment:** local guidance or specialist capability for user-specific decisions
3. **Action:** tools or CLIs for recurring operations
4. **Presentation:** a form the user can inspect, compare, query, annotate, approve, or reuse
5. **Continuity:** ownership of accepted output, feedback, durable knowledge, settled state, compaction, resume, and retry

Ask how the user judges the work. Chat and code are not sufficient for every workflow. Choose the smallest owner for each gap: existing capabilities plus a skill, an agent tool, an extension, or a project layer.

Check that repeated harness friction can be recorded, durable memories or instruction changes require user review, live failures can be preserved, and closed sessions retain diagnostic provenance.

## Command and capability visibility

Inventory effective user controls and the agent's startup surface.

- For slash commands, menus, and settings, record owner, audience, frequency, side effects, collisions, aliases, and obsolete entries. Slash commands are user controls, not agent capabilities.
- Check whether common actions, active state, consequential boundaries, and recovery are visible, rare actions remain searchable, and related controls share a management surface.
- For the agent, record permanent tools, schemas, prompts, startup messages, and injected state. Flag host-owned choices and rare operations that should move behind help, deferred discovery, a CLI, or a skill.
- Flag unsupported surface area such as every available provider, model, backend, or internal mode. Check that hidden capability has a clear discovery route.
- Compare actual use, wrong selection, first-turn model cost, command clutter, and user navigation. Ask what the user wants visible, searchable, or automatic.

## Presentation channel

Check that the agent can present material outside chat in a form the user wants to inspect.

- Ask which forms the user uses: Markdown, local HTML, rendered applications, images, diagrams, or project artifacts.
- Check whether the current channel uses the lightest suitable form and returns a rendered result with a useful path or handle rather than source markup.
- Check feedback, revision, privacy, and separation between disposable presentation and project output.
- Prefer recommending a compact skill plus existing file, browser, or CLI capabilities. Recommend an extension only when rendering, state, or interaction requires it.

## Mutable external contracts

- Check whether changing harness, CLI, provider, service, and remote details are read from current help, version, capabilities, or status.
- Flag mutable detail embedded in permanent guidance instead of stable routing and local invariants.
- Prefer recommending a thin wrapper over copied commands. Results should return useful state and an exact follow-up when needed, not the whole manual.
- Recommend one provider-adaptation owner only when a required tool dialect, transport, continuation, compaction, media, or execution contract justifies it.
- Flag silent fallback and duplicated assumptions across prompts, schemas, skills, and extensions.

## Lean subagents and independent judgment

Assess whether the environment provides native subagents, a compact extension, or a thin runner wrapper. Do not recommend another surface when the current harness or session already provides the capability.

- Check that the model surface exposes only natural actions such as start, continue, receive, inspect, and answer.
- Check that host profiles own models, reasoning, permissions, isolation, timeouts, transport, processes, and specialist prompts unless the agent must choose.
- Check that advanced management stays behind on-demand help or a CLI.
- Check results for worker identity, state, evidence, and continuation boundaries rather than blind polling or pane instructions.
- Check for a separate user surface to inspect, message, steer, and stop workers.
- Check isolated read-only exploration, narrow ownership, explicit handoffs, and side questions that enter main context only when chosen.
- Compare first-turn cost, natural use, and nearby non-use.

## Review loop

Assess whether maintained changes have an established review loop rather than an improvised sequence each time. It should identify the correct diff or stack boundary, support independent review, return findings to the working agent for verification and repair, let the user inspect the diff and dispositions, and rerun until consequential findings are resolved or accepted.

## Check environment coherence

Trace representative workflows across the complete environment and check that:

- instructions, skills, tools, extensions, profiles, commands, and UI support the user's operating relationship
- referenced capabilities and follow-up actions exist in the running setup
- user and agent surfaces connect without being mirrored by default
- base, project, and profile layers compose without conflicting policy or hidden overrides
- terminology, ownership, state, and continuation remain consistent across layers
- no capability is orphaned, duplicated, silently displaced, or dependent on a missing component
- intent can reach action, evidence, presentation, review, and recovery without an improvised bridge

Group symptoms under the cross-layer cause that explains them.

## Write the audit

Write the audit to a user-agreed Markdown file. Create no other artifact or environment change. Include:

- scope, evidence sources, work-specific layers, and limitations
- the user's workflows, operating relationship, and reported friction
- confirmed strengths
- findings ranked by effect on the user's work
- for each finding, current evidence, mismatch, suggested owner and surface, expected benefit and overhead, and how a later change should be validated
- gaps that need more evidence or another project folder
- suggested dispositions: keep, remove, trim, merge, move behind discovery, separate into a profile, or change

Do not score maturity or force a finding for every section. Prefer subtraction and clear ownership. Stop after presenting the audit for user review. Implement nothing unless the user makes a separate request.
