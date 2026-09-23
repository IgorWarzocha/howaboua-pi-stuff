---
"@howaboua/pi-shepherdr": patch
---

Fixed exact Ask answer confirmation and retry reconciliation without resending input.

- Keep answers pending while the original Ask is still open.
- Preserve accepted receipts when the worker's reply fails.
- Report dismissed Asks as rejected.
