---
"@howaboua/pi-notes-compaction": patch
---

- Fixed history lookup errors to identify the missing ID and explain how to retry. History arguments now clarify that read_item requires both IDs.
- GPT-mode checkpoint guidance uses denser prose.
- New-window guidance tells agents to read task-relevant skills again.
- Notes write receipts now contain only the saved path.
- Idle rollover offers Off, 25m, 55m, 2h, 6h and 12h. Hour presets roll over five minutes early; saved 5- and 15-minute settings remain valid.
