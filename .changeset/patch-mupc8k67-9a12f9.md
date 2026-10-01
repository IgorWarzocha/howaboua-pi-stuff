---
"@howaboua/pi-codex-conversion": patch
---

Codex usage history backfill and explicit-path analysis now run without Pi or TypeBox host dependencies.

Standalone ledger reports require `--file`, and session scans require `--root`. Pi's Usage analysis action supplies the ledger path.
