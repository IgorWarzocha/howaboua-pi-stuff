---
"@howaboua/pi-codex-conversion": patch
---

- Fixed Code and Notebook losing nested Pi tools’ termination signals after successful cells.
- Background requests no longer overwrite the session’s cache status; diagnostics logs still include them.
- Notebook startup lists reusable bindings without volatile memory, age or checkpoint diagnostics; full status remains available on demand.
- GPT prompt mode uses denser runtime guidance.
- Notebook guidance distinguishes top-level JSON input from direct objects inside exec.
- Usage comparisons show “not enough history” instead of a monthly percentage when recording began partway through last month.
- Usage analysis defaults to the working directory and its descendants.
- Usage analysis proposes folder and session drill-downs for approval.
- Fixed usage scans treating Unicode line separators inside valid session entries as malformed JSON.
