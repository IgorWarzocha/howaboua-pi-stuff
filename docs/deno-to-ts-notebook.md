# Recover a Deno Notebook in TS Notebook

Paste this into Pi and replace the bracketed text with a session, profile or project you want to recover. If the original Deno session is still open, leave it open until the agent has checked for unsaved state.

```text
Recover my Deno Notebook and adapt it to the current TS Notebook runtime.

Source: [Pi session, notebook profile or project]
Work I want back: [helpers, data or workflow]

1. Inspect the original without resetting it or overwriting anything. If the Deno kernel is still open, check for unsaved or live-only state before switching modes. Use saved checkpoints, project bindings and profiles for data. Use the saved notebook or Pi session history to recover source and understand what the cells did. Do not replay old cells or their side effects.

2. Recover the values and helpers needed for the workflow. Adapt Deno APIs and imports to the current Node-based TS Notebook. Recover pinned helpers where needed, but leave hooks off until you have checked their behaviour. If a value or dependency cannot be recovered, identify it rather than guessing.

3. Rebuild in a fresh TS Notebook session without replacing existing TS state. Use the current notebook tool's usage to check the available actions. Verify the helpers with read-only inputs or a disposable copy, then save and verify a checkpoint or a new named profile. Leave the original notebook and its files intact.

4. Tell me what you recovered, what you verified in TS, where you saved it, and what still needs Deno or my input. Carry on with the recoverable work if something is missing.
```
