---
name: pi-stuff-tool-contracts
description: "Read when reviewing or changing agent-facing extension contracts, prompts or guidance in this repository."
---

For tools, discover and load applicable general agent tool design guidance. Load prompt caching guidance when the active tool vector or system-prompt metadata changes.

Treat consequential agent-facing constraints as specifications. Use RFC 2119/8174 terms deliberately:

- MUST, REQUIRED, SHALL: obligation. MUST NOT, SHALL NOT: prohibition.
- SHOULD, RECOMMENDED and SHOULD NOT, NOT RECOMMENDED: strong recommendations with justified exceptions.
- MAY, OPTIONAL: permission or optionality, not uncertainty. State facts and possible outcomes in ordinary language.

Choose the actual strength, conditions and authority; do not mechanically capitalise every keyword. Remove a negative clause only when the remaining requirement entails it. Preserve recovery and exceptions. Capitalisation signals intent, not proven model compliance.

Start tool-specific standing guidance with `tool_name: concise guidance`, not "Use tool_name to..." framing. Preserve behavioural constraints and explicit action names.

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
- New probes need a concrete risk that existing checks cannot resolve. Missing captures limit the claims you can make; they do not automatically justify a new harness.
- Check affected model-visible results and run the owning package's relevant checks.

Measure schema and prompt text separately. Label source proxies as proxies, not emitted-payload or task-cost savings. Delete temporary captures and probes after validation.
