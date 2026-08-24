## Verify the active API

- Read the installed Pi package documentation and relevant neighbouring tools before implementation. Do not tune a legacy surface as if it were current.
- Extensions register tools with `pi.registerTool({...})`. Standalone definitions may use `defineTool({...})` where the active SDK supports it.
- Use `typebox` 1.x. Treat `@sinclair/typebox`, obsolete Pi package scopes, and removed custom-tool types as migration work.
- Use `StringEnum` from `@earendil-works/pi-ai` for string enums that must work with Google providers.
- Keep obsolete public aliases out of the schema. A safe `prepareArguments()` normalisation may remain when current model calls justify it.

If legacy markers are present, migrate them before wording or token optimisation. When migration is outside the authorised scope, report the exact blocker rather than certifying the old contract.

## Inspect what Pi sends

Trace the complete call path:

1. `name`, `description`, `parameters`, `promptSnippet`, and `promptGuidelines`
2. activation and conditional tool exposure
3. `prepareArguments()` and `execute()`
4. returned `content`, thrown errors, updates, and truncation
5. provider serialization and system-prompt additions

`label`, renderers, and most `details` are user, state, and presentation surfaces. Put every fact the model needs to continue in model-visible `content`. For locally composed tools, inspect the actual nested return conversion instead of assuming the top-level Pi contract.

## Keep prompt metadata narrow

- Use `promptSnippet` only when the tool belongs in Pi's compact inventory. Write one capability fragment without cosmetic punctuation.
- Use `promptGuidelines` only for non-obvious selection, sequencing, timing, or safety. Pi flattens guideline bullets, so name the tool in every line.
- Do not repeat schema facts in snippets or guidelines.
- Measure the exact emitted prompt and serialized schemas for each active mode and conditional tool set. Source lines are not the payload.

## Return the correct state

- Throw when execution fails. Returning error-shaped success content does not set Pi's tool error state.
- For partial mutation, mark the call as failed while stating what succeeded, what failed, and what must be reread before retrying.
- Include the path, identity, state, output, or continuation handle needed next in `content`.
- Make cancellation, truncation, empty output, running work, and completed work distinct when the next action differs.
- Keep sensitive or render-only state in `details`, but never hide recovery information there.

After implementation, inspect representative provider payloads and run the repository's applicable checks.
