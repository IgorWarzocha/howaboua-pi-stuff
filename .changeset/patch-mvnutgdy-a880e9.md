---
"@howaboua/pi-observatory": patch
---

- Existing Observatory indexes require a one-time rebuild with pi-observatory --rebuild.
- Call details and conversation excerpts now read original JSONL records instead of duplicating payloads in SQLite.
- Missing or changed source records now appear as unavailable details while indexed statistics remain accessible.
- Added --detail for read-only call inspection without starting the viewer or collectors.
- Unchanged session scans no longer write to the index.
