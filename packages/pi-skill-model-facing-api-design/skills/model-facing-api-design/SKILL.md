---
name: model-facing-api-design
description: "Designs and reviews model-facing Pi tool contracts: names, descriptions, schemas, prompt snippets/guidelines, results, errors, and truncation. Use when adding or refining tools, or improving tool selection, calls, recovery, or prompt cost."
---

# Model-facing Pi tool design

Design tool contracts that models select, call, and recover from correctly. Optimize task success first; compress only after the behavior is clear.

## Contract surfaces

Treat both halves of a tool as model-facing:

- **Before a call:** `name`, `description`, `parameters`, `promptSnippet`, and `promptGuidelines` shape selection and arguments.
- **After a call:** returned `content`, thrown errors, truncation notices, and continuation handles shape the next decision.

`label`, renderers, and most `details` fields are user/state surfaces, not substitutes for text the model needs. Pi sends result `content` to the model; keep `details` for rendering, persistence, and structured extension state.

## Current-API gate

Do not optimize a legacy Pi tool surface as if it were current.

- Current extension tools use `pi.registerTool({...})`; standalone or SDK tool definitions may use `defineTool({...})`.
- Current schemas depend on and import from `typebox` 1.x. `@sinclair/typebox` compatibility is temporary and MUST be migrated.
- Current Pi packages use the `@earendil-works/pi-*` scope. Old package scopes and removed custom-tool types MUST be migrated.
- Do not add compatibility fields or shims merely to preserve a checked-in legacy API. If `prepareArguments()` translates removed public fields or shapes, require migration and removal of that shim; current normalization unrelated to an obsolete API may remain.

If legacy markers are present, stop the normal wording/token review. If edits are authorized, port the extension first; otherwise return the files and required replacements as a blocker. Do not certify or tune the old surface.

## Workflow

1. **Inspect behavior before wording.**
   - Run the current-API gate first. Treat migration as prerequisite work, not an optional recommendation.
   - Read the registration, schema, `execute()` path, result formatting, and relevant neighboring tools.
   - Identify the action, required inputs, defaults, side effects, output limits, success evidence, and recoverable failures.
   - Check real misuse or traces when available. Do not redesign around imagined model weakness when the current contract already works.

2. **Choose the tool boundary and name.**
   - Give one tool one coherent job. Split unrelated operations when doing so removes invalid argument combinations or unclear selection.
   - Keep related modes together when an action enum and shared inputs are easier to call correctly.
   - Use short, familiar `snake_case` names. Prefer common verbs and nouns over product lore or clever branding.
   - Compare nearby tools: the model should be able to explain why this tool is the right one.

3. **Write the description and Pi prompt metadata.**
   - State what the tool does and any result, side effect, limit, or selection boundary needed before calling it.
   - Keep the description compact, but use a second sentence when it prevents a realistic wrong choice.
   - Add `promptSnippet` when the tool should appear in Pi's one-line `Available tools` inventory. Use a short capability phrase; it need not repeat the full description.
   - Add `promptGuidelines` only for non-obvious timing, tool choice, safety, or repeated misuse.
   - Every Pi guideline MUST name the tool because Pi appends all guideline bullets into one flat section.

4. **Design the argument schema.**
   - Prefer model-familiar argument names such as `cmd`, `workdir`, `query`, and `path` when they match the domain.
   - Require inputs that every valid call needs. Make fields optional only when omission has a useful, deterministic meaning.
   - Put defaults, units, limits, and mutually dependent requirements where the model sees them.
   - Use schema constraints instead of prose where practical. For Pi string enums, use `StringEnum` from `@earendil-works/pi-ai` for Google compatibility.
   - Avoid exposing implementation knobs, deprecated aliases, speculative options, or compatibility fields for removed schemas.

5. **Design success, failure, and large-output results.**
   - Return concise `content` that states what happened and includes the identity, path, handle, or state needed for the next action.
   - Do not rely on `details` to tell the model whether the call succeeded or what to do next.
   - Throw an error when execution failed; returning an error-shaped value does not set Pi's tool error flag.
   - Make errors actionable: name the bad input or failed condition, preserve useful state, and state a valid retry path when one exists.
   - Truncate potentially large output. Tell the model what was omitted and where or how to retrieve the remainder.
   - Keep cancellation distinct from success and ordinary failure when the distinction changes the next action.

6. **Remove duplication and accidental cost.**
   - Prefer clear names over prose that repeatedly explains those names.
   - Do not restate schema facts in guidelines unless the restatement changes tool choice or sequencing.
   - Remove marketing language, implementation trivia, decorative formatting, and examples that do not prevent real misuse.
   - Do not compress away required evidence, caveats, recovery information, or trigger boundaries merely to improve a token count.

7. **Validate the complete loop.**
   - Check representative selection, valid calls, invalid calls, empty results, failures, and truncated results as relevant to the tool.
   - Confirm the model can distinguish neighboring tools and continue correctly from both success and failure output.
   - Run repository checks for the changed extension. Use the token helper as a comparison aid, not a quality score.

## Token helper

The bundled script first rejects known legacy Pi tool markers with a migration-required message. For current code, it reports an o200k token proxy over detected tool-declaration and schema source lines. The count is heuristic: dynamic strings, imported schemas, and provider serialization can differ from the report.

Install its local dependency once:

```sh
cd <this-skill-directory>/scripts
bun install --frozen-lockfile
```

Then inspect an extension file or directory:

```sh
node <this-skill-directory>/scripts/tool-token-lines.mjs <extension-path>
```

Use `--json` for machine-readable output. Review all reported lines; compare totals before and after only when prompt cost is part of the task.

## Good shape

```ts
pi.registerTool({
  name: "fetch_job",
  description: "Fetch a job and return its current state. Use poll_job for an already-running request.",
  promptSnippet: "Fetch a job by ID.",
  parameters: Type.Object({
    id: Type.String({ description: "Job ID." }),
  }),
  async execute(_id, params) {
    const job = await fetchJob(params.id);
    if (!job) throw new Error(`Job not found: ${params.id}. Check the ID and retry.`);
    return {
      content: [{ type: "text", text: `Job ${job.id}: ${job.status}` }],
      details: job,
    };
  },
});
```

## Smells

- The description starts with “This tool allows you to…” or explains internals before behavior.
- Several optional fields permit calls that can never be valid.
- Guidelines say “this tool” instead of naming the tool.
- The model receives “Done” without the changed target, resulting state, or next handle.
- Failure is returned as successful content instead of thrown as a tool error.
- Output can grow without a visible cap and truncation notice.
- UI labels or `details` contain information absent from model-visible text.

## Finish

For implementation work, update the tool and run relevant checks. For review-only work, return the exact surfaces examined, proposed wording or schema changes, and any behavior assumptions that need confirmation. Do not force a scorecard or table when direct edits or concise findings are clearer.
