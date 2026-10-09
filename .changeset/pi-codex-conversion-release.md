---
"@howaboua/pi-codex-conversion": patch
---

### Breaking changes

- **BREAKING CHANGE:** Requires Pi 1.1.0 or newer. Update Pi before updating Codex Conversion.
- **BREAKING CHANGE:** Sites tools moved to `@howaboua/pi-chatgpt-sites`. Remove the old `sites.toml`, `sites_documentation.toml` and companion directory, install the new extension, then reload Pi. Existing repository bindings are preserved. Calls now use `sites({resource, action, params})` and `sites_documentation({topic})`.

### Features

- Added Ultrafast selection alongside per-family Fast Mode and a Daybreak toggle that selects an available access program without changing the model.
- Support a separate notes extension while preserving Codex tools, cached remote lookup, cross-agent notes and history, and normal compaction. Compaction respects the active context window.
- Select native microphones and speakers in settings, including system defaults and saved unavailable devices. Changes apply on the next local audio start.
- Save voice and context-summary preferences from the LAN browser for the next call without restarting the current call. Project settings can disable globally configured context summaries.
- Transfer voice through `agents focus`, retaining the microphone and browser connection while switching to the destination's context. Handoffs include attributed context and a return action without starting an agent task.
- Choose primary and alternate voices in terminal or browser settings. Each session transfer alternates voices and greets the user in the destination's context.

### Improvements

- Notebook returns help when called without arguments, including an empty structured object. Explicit help remains supported.
- Reasoning guidance raises effort for difficult or uncertain work and lowers it for routine work. Exec guidance calls for timeouts on operations that might not finish on their own.
- Notes guidance keeps task checkpoints at stable paths and separates reusable topic notes. Note-save bookmarks label the next user prompt as Notes. Selecting it in `/tree` restores the prompt at the saved checkpoint.
- Pending remote notes, history results and completed-cell receipts no longer expire after 15 minutes. Long-running cells can accept more than 32 remote calls.

### Fixes

- Cancelled runs no longer trigger checkpoint rollover, qualify for idle rollover or receive a Notes saved marker after cancellation.
- Context-window history starts with the first applicable turn rather than model selection or tree navigation.
- Preserve partial-answer labels during replay and compaction.
- Fix voice context summaries for compacted conversations containing remote tool results.
- Fix quota refresh after reloads and session switches.
- Voice and dictation refuse startup while another voice provider is active, including during reconnection and microphone transfer.

