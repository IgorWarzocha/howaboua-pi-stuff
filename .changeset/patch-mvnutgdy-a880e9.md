---
"@howaboua/pi-observatory": patch
---

- Existing Observatory indexes rebuild automatically once when the updated server starts. Source files are preserved.
- Call details and conversation excerpts now read original session files rather than stored copies.
- Missing or changed source records now appear as unavailable details while indexed statistics remain accessible.
- Added --detail for read-only call inspection without starting the viewer or collectors.
- Unchanged session scans no longer write to the index.
