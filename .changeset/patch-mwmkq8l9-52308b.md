---
"@howaboua/pi-agent-comms": patch
---

- Fix role switches and context rollover when a temporary reasoning boost expires.
- Shorter Notes guidance clarifies the checkpoint required for context rollover.
- Notes reads, lists and searches reuse the same loaded notes.
- Fixed shared Notes reads and lists failing for a remote-backed parent session.
- History reads do less work per page, and ranked searches reuse unchanged search scopes.
- Shorter board guidance clarifies how to copy a full thread ID and recover from closed threads.
- Board accepts `reply` as an alias for posting to a thread.
