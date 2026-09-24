---
name: extension-design
description: "Read before creating or refining a coding-agent extension."
last-changed: "2026-09-24"
---

## Choose the missing surface

Use current harness docs and examples, not remembered APIs. Start from who initiates the workflow and what the harness or an existing CLI already does. Prefer a direct command or thin wrapper. An extension must need hooks, state, UI, or tool registration. Resolve an ambiguous product choice with the user, but implement an already specified or delegated shape without another approval round.

- Users operate UI and slash commands. Agents use tools or discoverable CLIs. Do not mirror the two surfaces by default.
- Keep rare user-invoked work out of permanent agent tools. Give the agent only choices it must make, not host policy or backend machinery.
- Reuse the setup's navigation and settings patterns. Put related actions and persistent settings in one skimmable management surface. Configuration files are storage, not the interface.
- Keep machinery proportional to the actual risks. Remove speculative modes, compatibility layers, and configuration. Agent results need useful state or a next action, not the surrounding workflow.

Load an applicable tool-design skill before changing an agent-facing tool. The README explains outcome, installation, first action, and material boundaries. Ordinary settings and actions belong in the product.

## Validate the right surface

- Test a local candidate before changing the live setup. Consult current harness controls for isolation. For agent-behaviour comparisons, load an applicable instruction-calibration skill rather than inventing another workflow.
- Measure emitted schemas, prompt additions, startup messages, and results against an equivalent first turn without the extension. Keep model, task, context, and harness version fixed. Task success comes before token savings.
- Test natural use and the nearest non-use case in fresh sessions. When evaluation is delegated, complete it autonomously and close finished test panes. Do not claim that automated checks establish the user's preference for a human interface.
- After isolation, check the affected workflow in the complete extension setup: collisions, displaced capabilities, startup cost, cache behaviour, and removal. Leave live activation to the user's existing authorization. Human UX acceptance still belongs to the user.
