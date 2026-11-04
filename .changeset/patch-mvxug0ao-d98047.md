---
"@howaboua/pi-codex-conversion": patch
---

Requires Pi 1.5 or newer.

- Extension updates now use Pi's native changelog notices and `collapseChangelog` setting. Custom suppression is removed.
- Large streamed tool calls now parse incrementally instead of repeatedly parsing the accumulated input.
- Code and Notebook now use the same tool-argument coercion and validation as native Pi calls.
- Code and Notebook now preserve extension tools' declared structured results.
- Code guidance now distinguishes printed output from the printers' undefined return value.
- TS execution now uses tsrs 0.21.0 with TypeScript 7.1 beta.
- Fixed repeated argument preparation for extension tools called through Code or Notebook.
- GPT-6.1 Terra, GPT-6 Sol and GPT-6 Luna now support reasoning off, following Pi's model catalogue.
- Tool expansion hints now use your configured keybinding.
- General guidance now tells agents to act on clear requests and defer work only when the user explicitly asks.
- Removed unnecessary punctuation from tool guidance.
- Fixed Realtime voice resubmitting Pi tasks from progress updates without new user speech.
- Codex Live now ignores repeated identical handoffs within one user turn while preserving repeat requests from later turns.
- Codex Live preserves captured speech when a handoff contains only part of the request.
- Voice task preparation now explicitly forbids turning instructions into questions or adding unrequested conversational next steps.
- Voice task preparation now preserves the user's tone, register and emphasis.
- Fixed generated task text appearing as user speech.
- LAN Stop now waits for the voice call and pending task preparation to stop.
- Herdr Disconnect now shuts down the selected LAN listener after stopping the call.
- Read and save global voice settings from the host without starting Pi or a voice call.
