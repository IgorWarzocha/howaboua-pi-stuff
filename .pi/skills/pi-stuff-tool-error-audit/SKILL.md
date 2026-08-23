---
name: pi-stuff-tool-error-audit
description: "Read when auditing tool and Notebook failures across stored Pi sessions or checking recovery since this repo's previous audit."
---

Discover and load an applicable agent-session diagnostics skill before attributing recurring failures.

Run the bundled script instead of grepping session JSONL:

```sh
deno run --no-config --allow-read --allow-env=HOME,PI_CODING_AGENT_DIR .pi/skills/pi-stuff-tool-error-audit/scripts/audit-tool-errors.ts
```

It treats a persisted `isError` result or failed nested Notebook trace as a marked failure, keeps unmarked nonzero subprocess exits separate, clusters signatures, and follows later tool results to the next user boundary.

Use the cursor in `state.json` for the normal audit. Override it with `--since 14d` only for an explicit retrospective. Read `references/interpretation.md` before judging the report.

Do not print tool inputs, user messages, or raw session content in a broad audit. Use the reported session path and line numbers to inspect only a selected incident after the aggregate identifies it.

Advance the cursor with `--mark-checked` only after reviewing the complete unfiltered window. Add `--allow-write=.pi/skills/pi-stuff-tool-error-audit/state.json` to that run. The script records the audit start as the next lower bound, so calls arriving during the scan remain eligible.
