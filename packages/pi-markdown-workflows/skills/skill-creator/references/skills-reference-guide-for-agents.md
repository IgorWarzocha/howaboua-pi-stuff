# Skills Reference Guide for Agents

Use this guide to design, write, test, and package skills built around `SKILL.md` with optional `references/`, `scripts/`, and `assets/`.

This is deliberately more detailed than the main skill. It carries reusable judgment for new sessions, unfamiliar models, and substantial skill work. It is not a mandatory template: use the sections that match the task and target host.

## Reading map

- **Creating or substantially restructuring a skill:** read sections 1–14, then the relevant patterns and testing guidance.
- **Fixing triggering:** read sections 7–8, 17.1, and 19.1–19.2.
- **Splitting supporting material:** read sections 5 and 12–14.
- **Debugging execution:** read sections 11, 15, and 19.
- **Packaging or final review:** read sections 20–22.

Host rules outrank this guide. Verify format limits, discovery behavior, supported frontmatter, and tool names against the host rather than assuming every agent surface is identical.

## 1. What a skill is

A skill is a portable instruction bundle that teaches an agent how to perform a repeatable task or workflow consistently.

A good skill answers six questions:

1. What problem does this skill solve?
2. When should the host agent activate it?
3. What steps should the agent follow?
4. What tools, files, or references may be used?
5. What does successful output look like?
6. How should the agent recover when something fails?

A skill is not just a prompt. It is a compact operational contract.

## 2. Why skills exist

Skills exist to reduce repeated prompting, encode best practice, and improve consistency.

Use a skill when all of the following are true:

- The task recurs.
- The workflow has recognisable steps.
- Output quality improves when the same structure is reused.
- The agent benefits from domain rules, validation, or examples.

Do not create a skill for a one off task, an empty abstraction, or a workflow that is still fundamentally unclear.

## 3. Conformance language

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used in the RFC 2119 sense. Use hard requirements for host constraints, safety boundaries, or behavior the workflow cannot succeed without; use guidance for strong defaults that still require judgment.

## 4. Core design principles

### 4.1 Progressive disclosure

A skill SHOULD reveal information in layers.

- **Layer 1: frontmatter** indexes the job, activation conditions, and boundaries.
- **Layer 2: main body** tells the agent how to execute the workflow.
- **Layer 3: linked files** hold detailed references, scripts, schemas, examples, templates, or assets.

The frontmatter must stay terse and trigger focused. The body must stay operational. Dense conditional material belongs in supporting files.

### 4.2 Explicit triggering

A skill is only useful if it loads when needed and stays quiet when irrelevant.

The description in frontmatter MUST encode:

- what the skill does
- when to use it
- trigger phrases or situations
- file types or artefacts, if relevant

Where confusion is likely, the description SHOULD also say when **not** to use the skill.
Descriptions are semantic indexes, not prose introductions. Compress intent into concrete job, trigger, artifact, outcome, and boundary terms.

### 4.3 Composability

Multiple skills may coexist. A skill MUST NOT assume it is the only capability available.

A composable skill:

- avoids conflicting global instructions
- scopes itself to a clear domain
- does not forbid unrelated host abilities unless necessary
- can hand off to other skills cleanly

### 4.4 Portability

A skill SHOULD avoid product marketing, UI specific instructions, and vendor naming unless the skill is explicitly tied to one host or tool.

Keep the skill usable across different agent surfaces where possible.

### 4.5 Determinism where it matters

Natural language is flexible. Workflows are not.

A good skill makes critical behaviour as deterministic as possible by defining:

- preconditions
- validation rules
- step order
- stop conditions
- output contracts
- error handling

If a check can be performed by code, a script is often better than prose.

### 4.6 Deliberate context

A skill should carry the smallest body that reliably preserves its job and judgment. Shorter is not automatically better: removing trigger coverage, edge cases, or domain rules can make a skill cheaper and worse.

Keep `SKILL.md` focused on instructions needed for normal execution. Put conditional depth in `references/`. Remove repeated reminders and examples before removing material that helps weaker or context-poor models act correctly.

### 4.7 Proportionate failure behaviour

Block only when uncertainty affects correctness, safety, external side effects, or the ability to complete the requested result.

Examples:

- Missing load-bearing inputs -> ask for them or stop.
- Validation failure that makes the output unsafe or invalid -> report it and do not proceed.
- Tool connection issue -> report the concrete failure before dependent side effects.
- Ambiguous destructive action -> request confirmation if the host or policy requires it.

Do not turn every normal run into preflight diagnostics. Try the ordinary, low-risk path first when availability can be established by using it.

## 5. Skill anatomy

A typical skill folder looks like this:

```text
your-skill-name/
├── SKILL.md
├── scripts/
│   ├── validate.py
│   └── transform.sh
├── references/
│   ├── api-patterns.md
│   ├── schemas.md
│   └── examples/
└── assets/
    ├── template.md
    └── sample.json
```

### 5.1 Required file

`SKILL.md` is required.

It MUST:

- be named exactly `SKILL.md`
- begin with valid YAML frontmatter
- contain the operational instructions for the skill

### 5.2 Optional folders

`scripts/` is for executable helpers.

Use it for:

- validation
- data transformation
- formatting
- repeatable deterministic checks
- machine readable post processing

`references/` is for material the agent may consult only when needed.

Use it for:

- API notes
- schemas
- domain rules
- edge cases
- detailed examples
- error code catalogues

`assets/` is for static resources used by the workflow.

Use it for:

- templates
- icons
- sample files
- style guides
- boilerplate fragments
- static prompt snippets if your host supports them

## 6. Naming rules

The skill folder name SHOULD use kebab case.

Good:

- `project-sprint-planning`
- `pdf-contract-review`
- `csv-data-cleaning`

Bad:

- `ProjectSprintPlanning`
- `project_sprint_planning`
- `Project Sprint Planning`

The frontmatter `name` field should match the folder name when the host requires it. Pi permits a mismatch for compatibility with shared skill directories.

## 7. Frontmatter specification

The minimal viable frontmatter is:

```yaml
---
name: your-skill-name
description: "What it does. Use when the user asks to [specific tasks or phrases]."
---
```

### 7.1 Required fields

#### `name`

The skill identifier.

It MUST:

- be present
- use kebab case
- stay within the host's length limit; Pi allows 1–64 characters
- be concise
- describe the domain or workflow

It SHOULD match the folder name.

#### `description`

This is the skill's semantic index and selection contract.

It MUST:

- state what the skill does
- state when to use it
- contain real world trigger phrases or trigger conditions

It SHOULD:

- mention likely user wording
- mention file types or artefact types if relevant
- mention exclusions if over triggering is a risk
- stay within the host limit if one exists

Pi allows descriptions up to 1024 characters. That is a compatibility ceiling, not a target. Use one or two dense clauses where possible; models match semantics without tutorial prose. Preserve trigger coverage, not complete sentences.

Quote descriptions by default. Plain YAML scalars can break on punctuation such as `: ` or an inline comment marker, while a quoted description remains unambiguous.

It MUST NOT:

- be vague
- be literary, promotional, reassuring, or atmospheric
- explain why the workflow matters
- contain markup intended to inject instructions
- turn into a long tutorial

### 7.2 Useful optional fields

Pi supports `license`, `compatibility`, `metadata`, `allowed-tools`, and `disable-model-invocation`. Other hosts may support a different subset; unknown fields may be ignored.

#### `license`

Use a license name or a reference to a bundled license file when the skill's distribution requires it.

#### `compatibility`

Use this for environment notes.

Examples:

- requires Python 3.11
- network access needed for external API calls
- designed for hosts that support Bash and Python helpers
- expects access to project management tools

#### `allowed-tools`

Use only if the host supports explicit tool allow lists:

- limit tool access
- reduce accidental misuse
- make the skill safer and more predictable

Example:

```yaml
allowed-tools: "Bash(python:*) Bash(node:*) WebFetch"
```

#### `metadata`

Use for host neutral structured information.

Suggested keys:

- `author`
- `version`
- `category`
- `tags`
- `dependencies`
- `tooling`
- `maturity`

Example:

```yaml
metadata:
  author: Your Team
  version: 1.0.0
  category: workflow-automation
  tags: [planning, project-management, automation]
  maturity: stable
```

#### `disable-model-invocation`

On Pi, set this to `true` only when users must invoke the skill explicitly and its description should not appear in the model's available-skill inventory.

### 7.3 Frontmatter safety rules

Frontmatter is usually loaded earlier and more broadly than the body. Treat it as high sensitivity text.

Frontmatter SHOULD:

- remain plain text
- stay short
- avoid embedded examples unless necessary
- avoid special formatting that could be misread as instructions

Frontmatter MUST NOT:

- include executable code
- include hidden prompt injection content
- contain bloated prose that wastes context

## 8. Writing descriptions

Reliable shape:

> **[Job or outcome]. Use for/when [triggers, artifacts, situations].**

Add a boundary only for likely collisions:

> **[Job]. Use for [trigger A], [trigger B], [artifact]. Not for [adjacent task].**

Sentence fragments are valid. Optimize for semantic coverage per token, not conversational flow.

### 8.1 Good descriptions

```yaml
description: "Sprint planning and backlog breakdown. Use for prioritization, ticket decomposition, scope estimates, or capacity planning."
```

```yaml
description: "PDF contract review: obligations, risks, renewals, missing clauses. Use for contract analysis or clause extraction. Not general PDF summaries."
```

### 8.2 Bad descriptions

```yaml
description: "Helps with projects."
```

Problem: too vague.

```yaml
description: "Implements the project entity model with hierarchical relationships and storage abstractions."
```

Problem: tool or architecture centric, not user trigger centric.

```yaml
description: "Transforms messy ideas into powerful, crystal-clear plans that unlock confident execution."
```

Problem: atmospheric and promotional; weak retrieval terms.

### 8.3 Under triggering and over triggering

If the skill does not load when it should, expand the description with more concrete tasks and wording variants.

If the skill loads too often, tighten scope and add exclusions.

Example tightening:

```yaml
description: "CSV statistical analysis: regression, clustering, significance tests. Use for modelling or inference. Not charting or spreadsheet cleanup."
```

## 9. The body of `SKILL.md`

The body starts where execution starts. Never add `Purpose`, `When to use`, `Do not use when`, `Activation`, `Triggers`, or equivalent restatements. The frontmatter description already owns job and selection semantics.

Match register to task:

- **SOP, coding, tooling, review:** terse imperatives, decisions, constraints, commands, and checks. Fragments are acceptable. Remove mood and explanation.
- **Creative generation:** evocative body language is useful when it steers voice, imagery, taste, or ideation. Keep operational boundaries clear.
- **Descriptions:** always denotative and terse, including creative skills.

Consider these questions only when they change execution:

- What are the prerequisites?
- What inputs are expected?
- What exact steps should the agent perform?
- What must be validated before moving on?
- What should the output contain?
- What common failures exist and what should happen next?

### 9.1 Adaptable section layout

```markdown
# Skill Title

## Workflow

<!-- Add only when useful: -->
## Inputs
## Prerequisites
## Validation
## Recovery
## Output
## Examples
```

Do not manufacture empty ceremony. Inputs, prerequisites, validation, recovery, output contracts, and examples are valuable when they remove ambiguity or alter behavior; they are not compulsory headings.

### 9.2 What each section should contain

#### Inputs expected

Specify required and optional inputs.

Example:

- required: project name, target date, team members
- optional: capacity assumptions, historical velocity, labels

#### Prerequisites

Document required tools, access, or environment assumptions.

Examples:

- project tracker connection available
- Python 3 installed
- access token present in environment variables

#### Workflow

This is the core. It SHOULD use numbered steps and explicit sequencing.

For complex or failure-prone stages, define:

- the action
- the input
- the expected result
- the next branch if it fails

#### Validation

List checks that must pass before finalisation or side effects when invalid output is plausible or consequential.

#### Error handling

List common failures, causes, and recovery actions.

#### Output contract

State exactly what the result should contain.

Examples:

- summary plus ticket list
- generated file path
- table with specified columns
- JSON matching a schema

#### Examples

Include a small number of realistic examples when they teach decisions, boundaries, or output shape that prose does not make obvious. Do not add several examples that merely restate the workflow.

#### References

Point to bundled files by exact path.

## 10. Authoring procedure for agents

When an agent is asked to create a new skill, it SHOULD follow this procedure.

### Phase 1: Confirm skill fit

A skill is appropriate when:

- the task recurs
- the workflow is multi step or rule heavy
- consistency matters
- examples or validation would materially help

If the task is too vague, the agent SHOULD reduce it to 2 or 3 concrete use cases before drafting.

### Phase 2: Define concrete use cases

For each use case, write:

- **goal**
- **trigger**
- **inputs**
- **workflow**
- **result**

Example:

- goal: plan a sprint
- trigger: user asks to plan the sprint or create tasks
- inputs: backlog items, team capacity, due date
- workflow: analyse work, prioritise, break down, create tickets
- result: a sprint plan with tickets and estimates

### Phase 3: Map the workflow

Break the task into ordered stages.

Useful stage types:

- fetch or inspect
- validate
- transform
- decide
- generate
- review
- save or publish
- confirm

Define stop or recovery behavior where a failed stage would otherwise cause incorrect continuation, repeated work, or unsafe side effects.

### Phase 4: Define the output contract

Before writing instructions, define the final artefact.

Examples:

- markdown report with sections A to E
- JSON object matching schema X
- created tickets with title, estimate, owner, and link
- transformed CSV with standardised headers and a validation report

### Phase 5: Draft frontmatter

Write the `name` and `description` only after the use cases are clear.

The description MUST carry the job, triggers, artifacts/outcomes, and only necessary exclusions. Compress for semantic matching; do not write an introduction.

### Phase 6: Draft the main body

Choose the register before drafting. Operational skills use concise imperatives. Creative skills may use evocative language where it directly improves generation.

Prefer:

- numbered steps
- checklists
- exact file paths
- explicit conditions
- examples of good output

Avoid:

- abstract advice
- buried constraints
- decorative prose in operational skills
- long justifications
- any body section that restates the description

### Phase 7: Add support files

Move heavy detail into:

- `references/` for static knowledge
- `scripts/` for deterministic logic
- `assets/` for templates and samples

### Phase 8: Test and tighten

Start with a few representative trigger, non-trigger, execution, and failure cases. Tighten the description and instructions around observed gaps. Build a larger evaluation only when repeated use, risk, or distribution scale justifies it.

## 11. Instruction writing rules

### 11.1 Be specific and actionable

Bad:

```markdown
Validate the data before proceeding.
```

Better:

```markdown
Before generating output, validate the input CSV.

Checks:
1. Required columns exist: `date`, `customer_id`, `amount`
2. Dates use `YYYY-MM-DD`
3. `amount` is numeric
4. Duplicate rows are flagged

If any check fails, stop and return a validation summary.
```

### 11.2 Put critical rules near the top

Do not bury the most important constraints.

Bad skills often hide essential conditions in the middle of a long narrative.

### 11.3 Separate policy from procedure

Policy answers **what must be true**.

Procedure answers **how to do it**.

Keep them distinct.

Example:

```markdown
## Validation policy
- Do not create tickets without a title and owner.
- Do not estimate work when requirements are missing.

## Procedure
1. Parse the backlog.
2. Check each item for title, owner, and acceptance criteria.
3. If any item fails validation, return a blocked-items list.
4. Only then create tickets.
```

### 11.4 Define stop conditions

A skill SHOULD say when to stop iterating.

Example:

- stop when the required result exists and relevant validation passes
- set an iteration cap when the workflow could otherwise repeat without new evidence
- stop before dependent side effects when connection or authentication fails

### 11.5 Define idempotence where relevant

If a workflow may be run twice, say how duplicates are handled.

Examples:

- update existing ticket if identifier matches
- do not create duplicate records
- append version suffix to generated files

### 11.6 Prefer exact references

When pointing to supporting material, use exact paths.

Good:

- `references/api-patterns.md`
- `references/examples/create-project.json`
- `assets/report-template.md`

Bad:

- the docs folder
- some example file

## 12. Scripts and executable helpers

Use scripts when prose is too loose.

A script is appropriate when you need:

- deterministic validation
- repeatable transformations
- strict parsing
- schema enforcement
- output normalisation

### 12.1 Script design rules

Scripts SHOULD:

- accept explicit arguments
- avoid interactive prompts
- return stable exit codes
- write predictable stdout
- write diagnostics to stderr when possible
- document dependencies
- behave deterministically for the same input

Scripts MUST NOT:

- hide destructive side effects
- depend on manual intervention unless clearly stated
- require undocumented environment setup

### 12.2 Script contract example

```markdown
Run `python scripts/validate.py --input <file>`.

Expected behaviour:
- exit 0: validation passed
- exit 1: validation failed
- exit 2: execution error

Expected stdout:
- machine readable JSON summary

If exit code is 1, do not proceed with generation.
```

### 12.3 When not to use scripts

Do not add a script just to make the skill look sophisticated. If plain instructions are enough, keep it simple.

## 13. References and supporting knowledge

The `references/` directory prevents `SKILL.md` from becoming bloated.

Good contents for `references/`:

- API conventions
- rate limits
- pagination rules
- schemas
- field definitions
- error recovery notes
- domain terminology
- worked examples

### 13.1 How to write references

A reference file SHOULD be factual and chunkable.

Prefer:

- one topic per file
- short sections
- headings that mirror likely questions
- examples near the relevant rule

### 13.2 What not to put in references

Do not move core workflow instructions into `references/` if the agent always needs them. Core procedure belongs in `SKILL.md`.

## 14. Assets and templates

`assets/` is useful when the output needs a stable structure.

Examples:

- report templates
- email skeletons
- JSON schemas
- markdown boilerplates
- document style templates

If the skill expects a template, state that clearly in `SKILL.md`.

## 15. High value skill patterns

These patterns recur in strong skills.

### 15.1 Sequential workflow orchestration

Use when a task must happen in a strict order.

Pattern:

1. gather inputs
2. validate
3. perform step A
4. use output of A in step B
5. validate again
6. finalise

Best for:

- onboarding
- ticket creation
- multi step setup
- provisioning workflows

### 15.2 Multi tool coordination

Use when one task spans multiple services or tools.

Pattern:

1. fetch from tool A
2. transform or map the data
3. push to tool B
4. notify via tool C
5. log or save via tool D

Requirements:

- clear phase boundaries
- explicit data handoff between tools
- rollback or recovery plan for partial failure

### 15.3 Iterative refinement

Use when quality improves through review loops.

Pattern:

1. create draft
2. validate against checklist
3. fix specific defects
4. re validate
5. stop when criteria are met

Best for:

- reports
- design outputs
- generated documentation
- code generation with lint or test loops

### 15.4 Context aware tool selection

Use when multiple tools can achieve the same outcome and the right choice depends on context.

Pattern:

1. inspect file type, size, destination, or collaboration needs
2. choose the best tool using explicit criteria
3. explain the choice if useful
4. continue with tool specific steps

### 15.5 Domain specific guardrails

Use when the skill adds specialist judgement, not just tool access.

Pattern:

1. collect facts
2. apply domain rules
3. approve, reject, or route for review
4. document the decision

Best for:

- compliance
- quality assurance
- policy checks
- financial review
- safety screening

### 15.6 Validate before consequential work

Use when bad input is common and proceeding would waste substantial work, create invalid output, or cause side effects.

Pattern:

1. validate before any side effects
2. summarise issues clearly
3. only continue when the input is fit

This pattern prevents expensive or destructive work on broken input. Do not apply it as a universal diagnostics-first ritual when the ordinary action is cheap, safe, and self-validating.

### 15.7 Extract transform generate pattern

Use when the task is really a pipeline.

Pattern:

1. extract source information
2. transform to canonical form
3. generate the final artefact
4. run final checks

Best for:

- document generation
- data pipelines
- design handoff
- content repackaging

## 16. Anti patterns

### 16.1 Vague descriptions

If the description sounds like a category rather than a job, it is weak.

### 16.2 Tool centric framing

Users ask for outcomes. Many weak skills describe internal architecture instead of user intent.

### 16.3 Monolithic `SKILL.md`

If the main file becomes a giant manual, triggering and execution suffer.

### 16.4 Missing negative scope

Without exclusions, adjacent skills collide.

### 16.5 Hidden assumptions

If the skill assumes a connected service, installed runtime, or available file without saying so, it will fail unpredictably.

### 16.6 Unclear success

If the workflow has a specific artifact or completion condition but never states it, the agent improvises. Simple conversational skills do not need ceremonial output contracts.

### 16.7 Missing decision examples

When prose leaves a judgment point or output shape ambiguous, a well-chosen example can resolve it. Examples that teach nothing new only consume context.

### 16.8 Decorative prose

Descriptions never need voice: remove sales language, reassurance, imagery, and motivational filler. Operational bodies should be equally direct. Creative bodies may be evocative when language itself steers the output.

## 17. Testing strategy

Choose tests according to the skill's risk, complexity, and observed failure modes. These four axes are a menu, not a mandatory harness for every edit.

### 17.1 Trigger tests

Goal: verify that the skill loads when relevant and does not load when irrelevant.

Useful groups include:

- obvious trigger cases
- paraphrased trigger cases
- non trigger cases

Example:

Should trigger:

- plan this sprint
- break this work into tickets
- organise backlog items for next week

Should not trigger:

- what is the weather
- explain recursion
- create a photo realistic image

### 17.2 Functional tests

Goal: verify the workflow works.

Depending on the workflow, test:

- happy path
- missing input path
- invalid input path
- tool failure path
- repeated run path
- unusual but valid edge case

### 17.3 Output quality tests

Goal: verify that the result is structurally correct and useful.

Check:

- required sections exist
- formatting is stable
- fields are complete
- links or file paths resolve
- created artefacts are valid

### 17.4 Efficiency tests

Goal: ensure the skill reduces friction rather than increasing it.

When efficiency is a real concern, compare with and without the skill:

- number of tool calls
- number of retries
- amount of context consumed
- number of user corrections

## 18. Practical testing method for agents

A strong way to build a skill is to first solve one difficult real example manually, then extract the winning pattern into a reusable skill.

This works because:

- it exposes the true edge cases
- it reveals the actual step order
- it shows what the agent needed to know
- it makes the first version grounded rather than imagined

After one hard case works, broaden the test set only enough to cover materially different requests and failures.

## 19. Troubleshooting

### 19.1 Skill does not load

Check that the description names the concrete job and likely request language. Then validate frontmatter, discovery location, exact `SKILL.md` naming, host naming rules, and name collisions.

### 19.2 Skill loads too often

Narrow broad category language to the actual task, artifacts, and outcomes. Add negative scope only for plausible neighboring requests, and compare the description with overlapping skills.

### 19.3 Skill loads but instructions are ignored

Move critical rules near the action they govern, make ordering explicit, and replace vague verbs with observable conditions. Add an example or output shape only when the ambiguity remains.

### 19.4 Tool calls fail

Verify exact tool names, permissions, inputs, and documented return shapes. Record load-bearing prerequisites, but avoid diagnostics-first preflights when trying the safe operation reveals availability directly.

### 19.5 Output is inconsistent

Clarify the success condition and decision rules. Add targeted validation, one representative example, or a deterministic script according to the actual source of variation.

### 19.6 Context bloat or slowness

Remove repeated guidance and examples first. Keep normal execution in `SKILL.md`, move conditional depth into references, and preserve material that still changes agent judgment.

## 20. Packaging guidance

For this skill format:

- the skill lives in a single folder
- `SKILL.md` sits at the root
- supporting material stays under that root

Keep the skill folder clean.

A separate human facing repository README MAY exist outside the skill folder, but the skill itself SHOULD keep agent relevant documentation in `SKILL.md` and `references/`.

## 21. Adaptable skill skeleton

Start with frontmatter and workflow. Add the commented sections only when they change behavior or remove ambiguity.

```markdown
---
name: example-skill
description: "[Job/outcome]. Use for [triggers, artifacts, situations]."
---

# Example Skill

## Workflow
1. Inspect [relevant inputs or existing state].
2. Decide [load-bearing judgment].
3. Perform [core action].
4. Verify [observable success condition].

<!-- Add only when useful:
## Inputs
## Prerequisites
## Validation
## Recovery
## Output
## Examples
-->
```

## 22. Final review

Before shipping a skill, verify all of the following.

### Structure

- name follows the target host's format and length limits
- `SKILL.md` exists at root
- frontmatter is valid YAML
- required fields exist

### Trigger quality

- description states what the skill does
- description states when to use it
- description includes concrete request language or trigger conditions
- description is not too broad
- exclusions are added if needed
- description is terse, denotative, and free of introductory prose

### Instruction quality

- workflow is ordered
- consequential validation and failures are handled
- success is clear where the workflow needs a defined result
- examples teach distinct decisions where prose is insufficient
- supporting paths resolve
- body does not restate job or activation semantics
- register is terse for operational skills; creative language appears only when it steers creative output

### Operational quality

- load-bearing prerequisites are documented
- scripts have clear contracts
- deterministic checks use code where appropriate
- no critical assumption is left unstated

### Behaviour quality

- obvious trigger cases work
- paraphrased trigger cases work
- unrelated cases do not trigger
- invalid or missing input is handled in proportion to its consequences
- repeated runs avoid uncontrolled duplicates where side effects are possible
- repeated advice, examples, and generic reassurance were trimmed before useful judgment

Optimise first for reliable activation and execution. Then remove accumulated text that no longer changes behavior.
