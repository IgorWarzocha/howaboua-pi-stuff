---
"@howaboua/pi-agent-comms": patch
---

- Fix role switches and context rollover when a temporary reasoning boost expires.
- Shortened guidance on when to save notes before a context rollover.
- Notes reads, lists and searches reuse the same loaded notes.
- Fixed shared Notes reads and lists failing for a remote-backed parent session.
- History reads do less work per page, and ranked searches reuse unchanged search scopes.
