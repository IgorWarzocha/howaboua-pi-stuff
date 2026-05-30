# JavaScript / TypeScript Notes

Use this reference when applying agent-native hardening to JavaScript, TypeScript, Node, or web app repos.

## Scorecard naming

The main skill uses `contract_safety` as the language-neutral category. For JS/TS reports, it is acceptable to label the same category `fully_typed` when that matches the user's framing or an existing report, but score it with the contract-safety rubric.

## Common JS/TS risk signals

Penalize these strongly when they appear in central paths or public contracts:
- pervasive `any`, `unknown` immediately cast away, broad `Record<string, unknown>` plumbing, or untyped external data
- unsafe casts with `as`, non-null assertions, double casts, or unchecked JSON parsing
- manually duplicated DTOs between API, server, client, DB, queue, and UI layers
- type drift between schemas, database models, API handlers, client contracts, and tests
- flag-bag React/component state with many booleans or optional fields instead of discriminated unions
- positional tuples, string arrays, parallel arrays, magic column indexes, or table rows passed through domain logic
- catch-all `utils.ts`, `helpers.ts`, `lib.ts`, `types.ts`, or barrel files that absorb unrelated ownership
- root app files, route handlers, reducers, stores, or command dispatchers that keep gaining feature-specific branches

## Strong JS/TS patterns

Prefer these when hardening JS/TS code:
- strict TypeScript settings where practical: `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`
- discriminated unions for lifecycle, async, command, and UI state
- branded/domain types for IDs, slugs, paths, emails, external refs, and validated primitives
- runtime schemas at IO boundaries with inferred static types from the schema source of truth
- typed API/client contracts instead of duplicated request/response interfaces
- object parameters for functions with multiple same-shaped primitives
- feature folders that keep route/view, domain logic, schemas/contracts, IO adapters, and tests near their owner
- deterministic unit tests for pure transforms, reducers/state machines, schema parsing, and handler guards

## JS/TS baseline commands

During baseline discovery, inspect:
- root and package `package.json` scripts
- workspace files such as `pnpm-workspace.yaml`, `bunfig.toml`, `turbo.json`, `nx.json`, or package manager lockfiles
- `tsconfig*.json`, lint configs, formatter configs, test runner configs, and build configs
- generated `dist/`, `build/`, or `.next/` output only to confirm it is generated; do not treat generated code as source hotspots unless the repo edits it by hand

Common active checks:
- `npm|pnpm|yarn|bun run lint`
- `npm|pnpm|yarn|bun run typecheck`
- `npm|pnpm|yarn|bun test` or test-runner-specific scripts
- `npm|pnpm|yarn|bun run build`
- project-specific aggregate checks such as `check`, `check:changed`, or CI scripts

## JS/TS implementation cautions

- Do not silence errors by adding casts, `// @ts-ignore`, `// eslint-disable`, or weaker compiler settings unless the user explicitly asks and the tradeoff is documented.
- Do not create new broad `utils` or `types` dumping grounds. Shared JS/TS modules still need an owner such as `platform/fs`, `domain/user`, `ui/forms`, or `contracts/api`.
- Avoid refactors that move generated files, framework conventions, or build outputs unless the framework requires it.
- When splitting React/UI code, keep render components mostly pure and move effects, IO, state transitions, and data shaping into owned hooks/modules where that improves clarity.

## JS/TS modernization suggestions

After inspection, suggest these only as optional lanes unless the user already asked for upgrades:
- update TypeScript to the current stable version after verifying the latest version from an official package source
- enable stricter compiler options where they improve real safety, especially `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`
- strengthen linting with maintained rulesets and repo-appropriate boundaries, such as import ownership, no floating promises, no unsafe assignment/member access, and no broad suppressions
- make `check`/CI run lint, typecheck, tests, and build in the smallest reliable aggregate command the repo supports

If the user accepts one of these lanes, do the upgrade cleanly. Do not make TypeScript or lint pass by downgrading the target, relaxing strictness, scattering disable comments, adding broad ignore globs, converting failures to casts, or leaving exposed problems behind because they are inconvenient.
