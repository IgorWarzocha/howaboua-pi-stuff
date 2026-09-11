---
name: agent-tool-design
description: "Read before creating, reviewing, or refining a tool exposed to an agent."
last-changed: "2026-09-11"
---

For a Pi tool, also read `references/pi.md`.

## Start from what the agent knows

- Prefer canonical tool names and argument shapes already present in the target model's training.
- Treat a familiar tool schema as a runtime binding, not a tutorial. State only this implementation's meaningful deviations.
- Give an unfamiliar capability an obvious action name and familiar inputs. The agent should predict the call from the name and schema.
- When unsure, present the bare contract to the target model first. Add only the fact it could not infer correctly.

## Fix model choices at the model boundary

- When the implementation supports the right behaviour but the model selects the wrong action or argument, treat it as a model-facing contract failure first.
- Fix the name, default, argument description, or prompt guidance before adding runtime policy, heuristics, or extra state.
- Describe choices in terms of user intent, not only mechanics. “False returns immediately” explains execution. “Use false only while continuing other work” changes the model's decision.
- Test paired natural requests that differ only at the decision boundary. Confirm the model chooses correctly before changing implementation.

## Keep the decision surface small

- Give one tool one coherent job.
- Expose only decisions the caller must make. Keep providers, models, prompts, commands, internal modes, formatting, and policy inside the implementation unless the agent genuinely chooses them.
- Require only the minimum valid input. Add an optional field only when omission has a useful deterministic meaning.
- Prefer conventional names such as `cmd`, `path`, `query`, `cwd`, and `message`. Use a small enum when the choice is genuinely closed.
- If a field needs a paragraph to make sense, remove it, rename it, or reconsider the tool boundary.

## Let the schema speak

- Do not narrate types, requiredness, optionality, enums, defaults, or limits already encoded by the schema.
- Omit a field description when its name is sufficient.
- Write necessary descriptions as compact payload fragments: `Cwd`, `Wait ms`, `Recent days`, `Truncate`.
- Omit cosmetic terminal full stops, backticks, Markdown, examples, and grammatical padding. Preserve punctuation and formatting only when they carry literal syntax or prevent ambiguity.
- Keep safe compatibility aliases inside argument preparation rather than advertising them in the schema.

## Reject bloated tool contracts

- Existing text gets no exemption. When touching a tool or its integration, cull its entire model-facing contract before adding anything.
- Judge the assembled tool block, not individual fields or packages. A collection of short descriptions can still be an oversized manual.
- Each fact gets one representation per active mode. Reject repetition across usage, descriptions, schemas, snippets, guidelines, and help. Do not restate the tool name and action as its description.
- Keep inventory text to one short capability or exact usage line. Help-backed tools get one compact discovery entry; detailed actions, optional fields, and examples belong in help.
- Reject feature inventories, nested optional APIs, troubleshooting manuals, and generic agent workflow in standing prompts. Keep the immediate callable contract and necessary non-obvious constraints. Put rare invalid-state recovery in precise runtime errors.
- Every additional standing instruction must identify the concrete wrong decision it prevents and why the existing name, schema, help, or error cannot prevent it. Unfamiliar capabilities, local deviations, tool collisions, exact syntax, safety boundaries, and recurring mistakes may justify text; mere feature existence does not.
- "Preserve metadata", "feature parity", and "might help" do not justify prompt growth. Reject the change until redundant and unjustified text is removed; a net token reduction does not excuse remaining clutter.

## Return useful state

- On success, return the identity, path, state, output, or continuation handle needed next.
- On failure, identify the failed condition and a valid retry when one exists.
- Bound large output and make truncation visible.
- Keep render-only detail out of the model-facing result.

## Validate

Inspect the exact schema and prompt text sent to the model. Apply the rejection gate to every word, field, and guideline, including unchanged text in the touched contract.

Check representative valid calls, invalid calls, neighbouring-tool selection, empty output, failure, and continuation where relevant. Optimize task success first, then compare token cost.
