---
"@howaboua/pi-codex-conversion": patch
---

Make Code and Notebook Mode failures actionable and easier to recover.

- Surface Deno syntax diagnostics instead of generic execution failures and isolate bridge networking from user bindings.
- Encode action-specific notebook control inputs and return targeted recovery for persistent binding redeclarations.
- Clarify safe shell interpolation, terminal input, and Deno tool composition in model-facing guidance.
- Keep concurrent Code and Notebook sessions from taking optional Git index locks during read-only commands.
- Retry idempotent browser reads after delayed Chrome responses without blaming debugger approval, while warning against blind retries of timed-out page mutations.
- Return unambiguous tab references, prevent stale element aliases, support common ARIA menu controls, bound reference screenshots, validate browser references and pagination, serialize shared daemon state, release remote object handles, revalidate the requested control immediately before a native click, keep linked CLI entries executable, and expose the complete reference workflow in launcher help.
- Focus and verify the identity of referenced editable fields without first dispatching a potentially consequential click.
- Keep the Agents custom tool self-contained and remove the superseded Herdr Agent example.
- Let the Skills custom tool load one or more routed references directly by name.
- Preserve explicit `models.json` endpoints when installing the custom Codex transport and Daybreak model catalog.
- Keep package changelogs disabled with the Codex extension in Pi config.
- Keep LAN voice certificate startup compatible with asynchronous certificate generation.
- Release queued realtime delegations when native compaction fails, is aborted, or any post-compaction step errors.
- Defer queued Pi follow-up context until that follow-up begins its realtime handoff.
