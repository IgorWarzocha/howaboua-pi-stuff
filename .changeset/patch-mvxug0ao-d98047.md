---
"@howaboua/pi-codex-conversion": patch
---

Requires Pi 1.5 or newer.

Custom voice-helper overrides must be rebuilt. Bundled helpers update with the package.

- Extension updates now use Pi's native changelog notices and `collapseChangelog` setting. Custom suppression is removed.
- Large streamed tool calls now parse incrementally instead of repeatedly parsing the accumulated input.
- Code and Notebook now use the same tool-argument coercion and validation as native Pi calls.
- Code and Notebook now preserve extension tools' declared structured results.
- Code guidance now distinguishes printed output from the printers' undefined return value.
- Code and Notebook guidance now requires help discovery when a tool's current arguments are unknown, without repeating help for known calls.
- TS execution now uses tsrs 0.21.0 with TypeScript 7.1 beta.
- Fixed repeated argument preparation for extension tools called through Code or Notebook.
- GPT-6.1 Terra, GPT-6 Sol and GPT-6 Luna now support reasoning off, following Pi's model catalogue.
- Tool expansion hints now use your configured keybinding.
- General guidance now tells agents to act on clear requests and defer work only when the user explicitly asks.
- Removed unnecessary punctuation from tool guidance.
- Fixed transient Codex transport failures becoming non-retryable after internal recovery was exhausted.
- Fixed Realtime voice resubmitting Pi tasks from progress updates without new user speech.
- Codex Live now ignores repeated identical handoffs within one user turn while preserving repeat requests from later turns.
- Codex Live preserves captured speech when a handoff contains only part of the request.
- Voice task preparation now explicitly forbids turning instructions into questions or adding unrequested conversational next steps.
- Voice task preparation now preserves the user's tone, register and emphasis.
- Voice task preparation now treats clear conversational wrap-ups as end-call requests.
- Fixed voice playback stalling on short audio tails and bursting after delayed scheduling.
- Fixed duplicated LAN audio while waiting for speech to finish.
- Codex Live now waits for supported LAN clients to finish speaker playback before ending the call.
- Codex Live now uses available Opus repair data for missing audio packets.
- Voice playback now logs content-free packet timing, missing-packet concealment, buffering, scheduling and LAN-queue diagnostics.
- Fixed generated task text appearing as user speech.
- LAN Stop now waits for the voice call and pending task preparation to stop.
- Herdr Disconnect now shuts down the selected LAN listener after stopping the call.
- Read and save global voice settings from the host without starting Pi or a voice call.
