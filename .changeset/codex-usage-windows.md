---
"@howaboua/pi-codex-conversion": patch
---

Added persistent Codex spend tracking between resets.

- Usage shows API-equivalent spend and tokens by model, estimated quota shares, and spend-rate comparisons with the previous reset window and month.
- A one-time background import seeds the current window and approximate previous week from recorded local session costs; later views use saved aggregates.
- Weekly observations reconcile inferred reset boundaries and freeze completed windows. Partial history and missing data remain explicit.
- `/codex usage analyse` gives the agent a bundled read-only report script for long-term trends and session-based reasoning breakdowns.
