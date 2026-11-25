---
"@howaboua/pi-agent-comms": patch
---

- Board and Notes help focus on accepted arguments and how to continue reads, without internal limits and bookkeeping.
- Board validation names the rejected action or field. Board failures distinguish safe read retries from writes that may have committed.
- Notes warnings about freshness and access appear in both text and structured results.
- If a checkpoint or rollover is pending, `new_context` reports that no new request was queued.
- The session-pruning confirmation reports a permission wait to Pi, with Cancel still selected by default.
