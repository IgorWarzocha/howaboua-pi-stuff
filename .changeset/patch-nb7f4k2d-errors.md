---
"@howaboua/pi-codex-conversion": patch
---

Make Notebook Mode failures actionable and prevent common invalid calls.

- Surface Deno syntax diagnostics instead of generic execution failures and isolate bridge networking from user bindings.
- Encode action-specific notebook control inputs and return targeted recovery for persistent binding redeclarations.
- Clarify safe shell interpolation and terminal input in model-facing guidance.
