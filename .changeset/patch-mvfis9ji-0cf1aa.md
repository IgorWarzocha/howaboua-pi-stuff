---
"@howaboua/pi-codex-conversion": patch
---

- Fixed Code and Notebook losing nested Pi tools’ termination signals after successful cells.
- Background requests no longer overwrite the session’s cache status; diagnostics logs still include them.
- Notebook startup lists reusable bindings without volatile memory, age or checkpoint diagnostics; full status remains available on demand.
- GPT prompt mode uses denser runtime guidance.
- Notebook guidance distinguishes top-level JSON input from direct objects inside exec.
