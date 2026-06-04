---
name: model-facing-api-design
description: "Writes and reviews Pi tool APIs: tool names, descriptions, argument schemas, `promptSnippet`, and `promptGuidelines`. Use when adding/refining tools or making tool descriptions/arguments more effective."
---

# Pi tool API design

## Purpose

Write tool definitions that models call correctly without wasting prompt tokens.

## Setup

Before running scripts in this skill, install script-local deps once from this skill's `scripts/` directory, using the user's package manager:

```sh
cd .pi/skills/model-facing-api-design/scripts
npm install
```

`bun install`, `pnpm install`, or `yarn install` are also fine. For packaged installs, use the installed skill path's `scripts/` directory. Do not add these deps to the repo root.

## Rules

- Tool text is behavior, not copy.
- Optimize for the shortest text that prevents likely misuse.
- Count token-ish cost: punctuation, backticks, extra spaces, repeated prefixes, and long identifiers all add prompt weight.
- Prefer clear tool/argument names over explanatory prose.
- Encode constraints in the schema when possible.
- Add `promptGuidelines` only for non-obvious use rules the model is likely to miss.
- Keep tools universal: no local paths, personal names, private workflow assumptions, or machine-specific defaults.

## Workflow

1. Define the tool contract.
   - What action does it perform?
   - What inputs are required?
   - What defaults matter?
   - What should make the model choose another tool instead?

2. Pick names.
   - Tool name: short, verb/noun, model-familiar, stable; use snake_case for tools.
   - Argument names: match common model vocabulary (`cmd`, `workdir`, `query`, `path`).
   - Avoid clever product names unless the user explicitly invokes that product surface.

3. Write the description.
   - One sentence.
   - Say what the tool does and the important result/side effect.
   - Do not repeat every argument.
   - Do not include implementation details unless they change use.

4. Write `promptSnippet`.
   - Shorter than the description.
   - Imperative or capability phrase.
   - Examples: `Run a command.`, `Edit files with a patch.`, `Search code and docs by meaning.`

5. Write argument schemas.
   - Required fields only unless optional fields change common behavior.
   - Field descriptions should be fragments, not paragraphs.
   - Mention defaults and limits: `Defaults to current cwd.`, `Max 30000.`, `Truncate excess output.`
   - Use enums/closed schemas instead of prose when possible.

6. Decide whether `promptGuidelines` are needed.
   - Omit them when name + description + schema are enough.
   - Add them for timing, tool-vs-tool choice, safety, or repeated misuse.
   - Prefix each line with the tool name if multiple tools share prompt space.
   - Keep each line independently useful; no motivational filler.

7. Compress and de-duplicate.
   - If a rule appears in the schema, do not repeat it in guidelines.
   - Move rare edge cases to runtime errors or README docs.
   - Delete obvious stack facts and marketing language.
   - Avoid backticks in model-facing text unless literal syntax matters.
   - Avoid filler punctuation and decorative formatting.
   - Trim extra spaces; they still cost tokens.
   - Prefer one compact line over multi-clause explanations.

8. For repo tools, inspect token cost with:
   - `node .pi/skills/model-facing-api-design/scripts/tool-token-lines.mjs <extension-cwd>`
   - If the tokenizer dependency is missing, run `bun install` inside this skill's `scripts/` directory first.
   - It reports o200k_base token counts for all detected tool-facing lines; do not filter the output.

## Token gotchas

- Backticks often tokenize separately; use them only for literal commands, values, or field names.
- `tool_name: ...` guideline prefixes help disambiguate, but repeated prefixes cost tokens. Use only when the prompt mixes several tools.
- Long enum values and argument names cost every time the schema is shown; keep names short but clear.
- Repeating the tool name inside every field description is usually waste.
- Examples are expensive; include only examples that prevent real misuse.

## Codex=>Pi style reference

- `exec_command`: description says it runs a shell command and may return a session ID; snippet is `Run a command.`
- `apply_patch`: description says create/edit/delete/move files; schema explains the required patch wrapper.
- `write_stdin`: field descriptions carry the behavior: session id, chars, wait, truncation.
- `view_image`: optional detail exists only when supported; description stays simple.
- Native web/image tools use empty schemas when arguments are forbidden.

## Good shapes

```ts
description: "Runs a shell command, returning output or a session ID for ongoing interaction."
promptSnippet: "Run a command."
cmd: Type.String({ description: "Shell command to execute." })
workdir: Type.Optional(Type.String({ description: "Defaults to current cwd." }))
```

```ts
description: "Append workflow-friction feedback to VENT.md."
promptSnippet: "Log repeated workflow friction."
promptGuidelines: [
  "vent: Use for repeated or systemic workflow friction, especially when the same manual workaround happens more than once.",
  "vent: Do not use for one-off lint/type errors or ordinary coding mistakes.",
]
```

## Smells

- Description starts with “This tool allows you to…”
- Description explains internals before behavior.
- Optional args exist because they were easy to expose, not because the model needs them.
- Guidelines restate the schema.
- Tool name is cute but not guessable.
- Text assumes the maintainer's machine, repo path, or private workflow.

## Output contract

Return:

- tool surfaces reviewed
- proposed wording
- what was compressed or removed
- behavior risks or changed assumptions
