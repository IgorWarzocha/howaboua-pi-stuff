---
"@howaboua/pi-codex-conversion": patch
---

Code Mode always uses the pinned official OpenAI runtime. Local builds and `tools.customRustBinariesDir` no longer override it. Other native helper overrides are unchanged.

- Updated bundled patch and path helpers to Codex 0.163 while preserving line endings and partial-failure results.
- Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.
- Added optional cache affinity for child-agent integrations without sharing execution state.
- WebSocket connection recovery allows up to three fresh retries within five minutes after the first failure, then switches to SSE with its own five-minute recovery window.
- Diagnostics now distinguish logical requests from retries and socket sends, including compaction and cache-warming traffic.
- Unexecuted tool proposals now show Pending without retaining renderer callbacks.
- Fixed source previews losing their tool background when truncated.
- Reduced history projection work for message-only histories.
- Usage-ledger updates and reports now run off the main thread to keep Pi responsive as usage history grows.
- Notebook journals now expire after one week without updates by default. `/codex` also offers indefinite retention or switching recording off and removing saved journals.
- Added optional session-checkpoint cleanup after one month or one week of inactivity. Cleanup is off by default.
