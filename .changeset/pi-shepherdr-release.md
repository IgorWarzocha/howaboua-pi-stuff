---
"@howaboua/pi-shepherdr": patch
---

### Breaking changes

- **BREAKING CHANGE:** Boards moved to `@howaboua/pi-agent-board`. Install it in every participating session and reload Pi. Existing archives, session bindings and subscriptions are preserved. Board settings now live under `/board`, not `/herdr`. The board extension requires Pi 1.1 or newer and Node.js 22.18 or newer.
- **BREAKING CHANGE:** Custom extension commands sent through `agents` require an `extensionCommands` allowlist in the receiving session's global `pi-shepherdr.json`. Add the commands you use, then update and reload both controllers and receiving agents. `/herdr` Settings shows the config path and format.

### Features

- Route `/quit`, `/model`, `/thinking`, `/name`, `/new`, `/reload`, `/resume` and `/compact` to agents. `/quit` shuts down Pi before closing its pane. Blocked commands return available commands instead of becoming model prompts. Skills and prompt templates remain supported.
- Focus running Pi sessions with `agents focus`, optionally transferring voice through GipPity Control or Codex Conversion. Handoffs retain the microphone and browser connection, identify the source device, session and pane without exposing session-file paths, and offer a return action without starting an agent task. Remote focus selects the destination's Herdr session. Client machine selection remains manual.
- Pass a shared-board thread to a spawned agent with `board_thread_id` so its initial task can read that context.
- Support shared and attached agents with different notes owners. Local checkpoints remain available after detachment.
- Accept `/root` as the live root of an agent's own family, including across connected machines. Missing or ambiguous roots fail explicitly. Exact spawn and find targets remain unchanged.

### Improvements

- Agents returns help when called without arguments, including an empty structured object.
- Delegation guidance keeps task ownership with either the parent or its delegated agent, avoiding duplicated work.

### Fixes

- Reduce redundant monitoring warnings when workers close, move or are unwatched. Retire question watches and suppress late collection failures.
- Coalesce repeated board-owner outage warnings until connectivity recovers. Preserve Herdr event-stream error details locally and over SSH.

