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

Record the installed TypeScript version and whether build/lint/framework tooling imports the `typescript` package programmatically. That distinction is load-bearing for TypeScript 7 adoption.

## JS/TS implementation cautions

- Do not silence errors by adding casts, `// @ts-ignore`, `// eslint-disable`, or weaker compiler settings unless the user explicitly asks and the tradeoff is documented.
- Do not create new broad `utils` or `types` dumping grounds. Shared JS/TS modules still need an owner such as `platform/fs`, `domain/user`, `ui/forms`, or `contracts/api`.
- Avoid refactors that move generated files, framework conventions, or build outputs unless the framework requires it.
- When splitting React/UI code, keep render components mostly pure and move effects, IO, state transitions, and data shaping into owned hooks/modules where that improves clarity.

## TypeScript 7 guidance

TypeScript 7.0 is the stable native Go-based compiler, distributed through the standard `typescript` package and invoked with `tsc`. Do not recommend the old `@typescript/native-preview` / `tsgo` path for stable adoption.

Treat migration as an opt-in modernization lane. TypeScript 7 is designed to match clean TypeScript 6 projects, but it turns TypeScript 6 deprecations into hard errors and does not preserve every legacy JavaScript/tooling behavior.

### Migration sequence

1. Move projects on TypeScript 5.x or earlier to TypeScript 6 first.
2. Fix TypeScript 6 deprecations rather than relying on `ignoreDeprecations`.
3. Verify a clean TypeScript 6 build with `stableTypeOrdering` before switching compilers.
4. Install TypeScript 7 from the normal `typescript` package and rerun the repo's type, declaration, build, lint, framework, and editor workflows.
5. Keep TypeScript 6 available only where a verified tool still requires its programmatic API; document the split and removal condition.

### Configuration review

TypeScript 7 adopts TypeScript 6's new defaults. Check projects that relied on implicit settings, especially:

- `strict` defaults to `true`
- `module` defaults to `esnext`
- `target` defaults to the latest stable ECMAScript target before `esnext`
- `noUncheckedSideEffectImports` and stable type ordering are enabled
- `rootDir` defaults to the directory containing `tsconfig.json`; set it explicitly when output layout matters
- `types` defaults to `[]`; list required Node, test-runner, or runtime globals explicitly

Remove or replace unsupported legacy configuration, including ES5 output, `downlevelIteration`, classic/`node`/`node10` module resolution, AMD/UMD/SystemJS/`none` module emit, and `baseUrl`. Choose `bundler` or `nodenext` semantics according to the actual runtime and build pipeline; do not copy a generic tsconfig blindly.

### Compiler API and ecosystem compatibility

TypeScript 7.0 ships the compiler and LSP language server but not the traditional programmatic compiler API. Before upgrading, find tools that import `typescript` directly, including ESLint/parser integrations, transforms, generators, documentation tools, framework compilers, language-service plugins, and declaration tooling. Do not plan around a future API until its stable contract exists.

Microsoft provides `@typescript/typescript6` and a `tsc6` executable for side-by-side migration. Use that compatibility path only when necessary, verify package-manager alias/binary behavior, and test the exact toolchain. Embedded-language/framework tooling may need to remain on TypeScript 6 until its integration supports the new API.

### JavaScript and JSDoc projects

TypeScript 7 intentionally aligns checked JavaScript more closely with TypeScript and removes several legacy Closure, constructor-function, expando, and CommonJS behaviors. For `.js`/JSDoc projects or libraries emitting declarations from JavaScript:

- read the official `typescript-go` `CHANGES.md`
- compare generated declarations, not only diagnostics
- replace constructor/prototype patterns with classes where required
- use `typeof` when referring to values in JSDoc type positions
- make rest parameters explicit and avoid mixed whole-object/property `module.exports` assignments

### Performance tuning

The native compiler parallelizes parsing, checking, emit, and project-reference builds. Start with defaults. Tune experimental `--checkers` or `--builders` only after measuring wall time and memory on representative local and CI hardware; their combined parallelism can oversubscribe constrained runners. Use `--singleThreaded` for constrained/debug comparison, not as a default workaround.

## JS/TS modernization suggestions

After inspection, suggest these only as optional lanes unless the user already asked for upgrades:
- adopt TypeScript 7 when the project and its compiler-API/framework tooling are compatible; follow the migration sequence above rather than jumping directly from older releases
- enable stricter compiler options where they improve real safety, especially `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`
- strengthen linting with maintained rulesets and repo-appropriate boundaries, such as import ownership, no floating promises, no unsafe assignment/member access, and no broad suppressions
- make `check`/CI run lint, typecheck, tests, and build in the smallest reliable aggregate command the repo supports

When a hardening assessment finds an older TypeScript version, surface TypeScript 7 evaluation as an optional recommendation, but do not treat version age alone as a defect. First identify documented pins, runtime/support policy, framework/compiler integrations, declaration compatibility, and tools that depend on the old compiler API. Report blockers and prerequisites even when immediate migration is not appropriate.

If the user accepts one of these lanes, do the upgrade cleanly. Do not make TypeScript or lint pass by downgrading the target, relaxing strictness, scattering disable comments, adding broad ignore globs, converting failures to casts, or leaving exposed problems behind because they are inconvenient.

## TypeScript 7 source anchors

- Stable release and migration overview: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- TypeScript 6 bridge defaults and deprecations: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- Native compiler JavaScript/JSDoc compatibility changes: https://github.com/microsoft/typescript-go/blob/main/CHANGES.md
