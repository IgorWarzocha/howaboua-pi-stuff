---
"@howaboua/pi-codex-conversion": patch
---

Make Code and Notebook Mode failures actionable and easier to recover.

- Surface Deno syntax diagnostics instead of generic execution failures and isolate bridge networking from user bindings.
- Encode action-specific notebook control inputs and return targeted recovery for persistent binding redeclarations.
- Clarify safe shell interpolation and terminal input in model-facing guidance.
- Retry idempotent browser reads after delayed Chrome responses without blaming debugger approval, while warning against blind retries of timed-out page mutations.
- Keep the Agents custom tool self-contained and remove the superseded Herdr Agent example.
