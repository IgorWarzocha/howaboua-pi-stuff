---
"@howaboua/pi-codex-conversion": patch
---

- Fixed Code and Notebook losing nested Pi tools’ termination signals after successful cells.
- Background requests no longer overwrite the session’s cache status; diagnostics logs still include them.
- Notebook startup lists reusable bindings without volatile memory, age or checkpoint diagnostics; full status remains available on demand.
- GPT prompt mode uses denser runtime guidance.
- Notebook guidance distinguishes top-level JSON input from direct objects inside exec.
- Usage comparisons show “not enough history” instead of a monthly percentage when recording began partway through last month.
- Usage analysis starts with all projects in the session history root and reports the scanned path.
- Usage analysis asks for evidence behind savings recommendations rather than treating high session costs as proven waste.
- Fixed usage scans treating Unicode line separators inside valid session entries as malformed JSON.
