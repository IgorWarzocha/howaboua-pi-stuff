---
"@howaboua/pi-shepherdr": patch
---

Fixed board results exceeding 8,000 serialized UTF-8 bytes. Reduced reads now return matching continuation cursors, oversized mutation acknowledgements leave no changes, and missing incremental-search markers fail without creating an archive.
