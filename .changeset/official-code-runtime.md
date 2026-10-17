---
"@howaboua/pi-codex-conversion": patch
---

Code Mode always uses the pinned official OpenAI runtime. Local builds and `tools.customRustBinariesDir` no longer override it. Other native helper overrides are unchanged.

Updated the bundled patch helper to Codex 0.163, retaining line-ending preservation and structured partial-failure results.

Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.

- Added optional cache affinity for child-agent integrations without sharing execution state.
- Routing fields now precede prompt input in outgoing requests.
- WebSocket connection recovery now tries one fresh socket before SSE fallback, with a five-minute recovery limit after the first failure.
- Unexecuted tool proposals now show Pending without retaining renderer callbacks.
- Fixed source previews losing their tool background when truncated.
- Reduced history projection work for message-only histories.
- Usage-ledger file operations now run asynchronously; JSON processing remains synchronous.
