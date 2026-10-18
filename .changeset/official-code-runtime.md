---
"@howaboua/pi-codex-conversion": patch
---

**Compatibility and retention**

- Code Mode always uses the pinned official OpenAI runtime. Local builds and `tools.customRustBinariesDir` no longer override it. Other native helper overrides are unchanged.
- Code runtime downloads now honour proxy environment settings.
- Notebook journals now expire after one week without updates by default. `/codex` also offers indefinite retention or switching recording off and removing saved journals.
- Added optional session-checkpoint cleanup after one month or one week of inactivity. Cleanup is off by default.

**PCC GPT prompt mode and tools**

- Added an opt-in experimental PCC GPT prompt mode built on Heavy, with compact instructions and a shared mode API for participating extensions. Existing off/on settings are unchanged.
- Code and Notebook use one discovery rule for help-backed tools, keeping arguments in on-demand help instead of repeated startup instructions.
- Built-in history and notes return usage for empty calls and explicit help requests without accessing storage.
- Code and Notebook accept either `max_files` or `max_results` for note search and listing limits.
- Updated bundled patch and path helpers to Codex 0.163 while preserving line endings and partial-failure results.
- Removed the custom-tool example for the retired Semantic Grep extension.

**Context and connection reliability**

- WebSocket connection recovery allows up to three fresh retries within five minutes after the first failure, then switches to SSE with its own five-minute recovery window.
- Repeated V2 compaction preserves active context-window guidance.
- Post-compaction cache warming uses the same native tool catalogue as generation.
- Initial context-window identity follows the prepared system prompt so it does not break the shared cache prefix.
- Automatic rollover resumes from the developer-role window handoff itself, without a separate continuation message. No-work notices also use developer-role delivery.
- Child-agent integrations can bind fresh or explicitly forked sessions and share cache routing without sharing execution state.
- Standard Codex requests now send base instructions as a leading developer message, matching Responses Lite and current OpenAI Codex, without inventing a prompt when none is supplied.
- Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.

**Responsiveness and diagnostics**

- Usage-ledger updates and reports now run off the main thread to keep Pi responsive as usage history grows.
- Reduced history projection work for message-only histories.
- Diagnostics now distinguish logical requests from retries and socket sends, including compaction and cache-warming traffic.
- Unexecuted tool proposals now show Pending without retaining renderer callbacks.
- Fixed source previews losing their tool background when truncated.
