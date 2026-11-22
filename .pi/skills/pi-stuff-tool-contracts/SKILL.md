---
name: pi-stuff-tool-contracts
description: "Read when changing agent-facing tool contracts, prompts, skills, AGENTS.md or subagent guidance in this repository."
---

For tools, discover and load applicable general agent tool design guidance. Load prompt caching guidance when the active tool vector or system-prompt metadata changes.

Treat consequential agent-facing constraints as specifications. Use RFC 2119/8174 terms deliberately:

- MUST, REQUIRED, SHALL: obligation. MUST NOT, SHALL NOT: prohibition.
- SHOULD, RECOMMENDED and SHOULD NOT, NOT RECOMMENDED: strong recommendations with justified exceptions.
- MAY, OPTIONAL: permission or optionality, not uncertainty. State facts and possible outcomes in ordinary language.

Choose the actual strength, conditions and authority; do not mechanically capitalise every keyword. Remove a negative clause only when the remaining requirement entails it. Preserve recovery and exceptions. Capitalisation signals intent, not proven model compliance.

Start tool-specific standing guidance with `tool_name: concise guidance`, not "Use tool_name to..." framing. Preserve behavioural constraints and explicit action names.

- Agent-facing text is behaviour. Keep contracts, prompts, skills and subagent guidance compact. Default to general-purpose assistance and scope coding assumptions to coding tasks.
- Extend existing tools rather than adding overlapping choices. Preserve familiar contracts and visible help. Help-backed tools default to no-argument discovery, or `{}` in structured mode. Show current arguments on demand. Use tools for agents and one routed slash command by default for users.
- Omit obvious field descriptions and duplicated guidance across names, descriptions, schemas, `promptSnippet` and `promptGuidelines`. Use the latter two only for concrete failures. Pi tool callbacks may need explicit native `Static` annotations.
- Hide extension internals in results and errors. Say what happened, what remains available and the next action. Leave account and configuration decisions to the user. Success may expose a new action, not invented workflow advice.
- Diagnose tool or prompt misuse from real use and fix the model-facing contract. Programmatic tests cover deterministic parser, executor, result and routing boundaries, not model choices.

## Telegraphic prose

Use for repository AGENTS.md and GPT-mode guidance. Topic-led fragments, short clauses, arrows for transitions. Drop recoverable words, not conditions, syntax, evidence or recovery. Preserve normal-mode prose. Measure tokens before joining words or trimming punctuation.

- Condition → action: `Retryable failure → retry twice. Still failing → report blocker.`
- Scope and exception: `Live TUI review: explicit request only → sandbox-reviewer. Probes need no sandbox.`

## Measure text

Inspect retained Notebook bindings before writing measurement tooling. Reuse `piStuffTokenCount` when available with existing package prompt and schema builders.

Use `scripts/tool-token-lines.mjs` as this repo's preliminary migration and copy-cost probe. If its dependency is absent, install it once:

```bash
(cd .pi/skills/pi-stuff-tool-contracts/scripts && bun install --frozen-lockfile --ignore-scripts)
node .pi/skills/pi-stuff-tool-contracts/scripts/tool-token-lines.mjs <extension-file-or-directory>
```

Add `--json` for machine-readable output. The helper rejects known obsolete TypeBox, Pi package-scope, and removed custom-tool API markers before reporting an o200k token proxy over detected source lines.

The proxy is not the emitted schema or prompt payload. It can miss dynamic strings, imported schemas, conditional modes, and provider serialization. Use it only to locate likely duplication.

## Validate the changed boundary

For wording-only edits, compare before-and-after prompt text and serialized schemas for affected modes using existing builders and token tooling. Review the diff for preserved instructions and constraints, and run focused checks. A small Notebook cell is enough; do not build an SDK harness, launch comparison sessions, or add tests merely because the text is model-facing.

For changes to schema shape, registration, prompt assembly, routing, or provider serialization:

- Capture before-and-after emitted schemas and prompt additions for the affected modes and conditional tool sets, including final provider rewrites. Reuse existing capture tooling first.
- Inspect assembled output across extension boundaries. Source proxies and passing functional tests do not prove the emitted contract.
- Code and Notebook bindings sit outside provider JSON schemas. Check their final guidance separately from native schemas; a callable binding does not prove its contract survived.
- New probes need a concrete risk that existing checks cannot resolve. Missing captures limit the claims you can make; they do not automatically justify a new harness.
- Check affected model-visible results and run the owning package's relevant checks.

Measure schema and prompt text separately. Label source proxies as proxies, not emitted-payload or task-cost savings. Delete temporary captures and probes after validation.
