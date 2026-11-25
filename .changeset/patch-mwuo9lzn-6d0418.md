---
"@howaboua/pi-agent-comms": patch
---

- Requires Pi 1.6.1 or newer.
- Shortened Board and Notes help and clarified how to continue reads.
- Board errors name the rejected action or field and distinguish safe retries from writes that may have completed.
- Notes access and freshness warnings now appear in both text and structured results.
- `new_context` says when a pending checkpoint or rollover prevented a new request from being queued.
- Session pruning reports a permission wait to Pi. Cancel remains the default.
