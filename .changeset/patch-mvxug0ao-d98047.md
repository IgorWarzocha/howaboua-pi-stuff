---
"@howaboua/pi-codex-conversion": patch
---

Requires Pi 1.5 or newer.

Custom voice-helper overrides must be rebuilt. Bundled helpers update with the package.

- Reduced parsing overhead for large streamed tool calls.
- Code and Notebook now preserve declared structured results and apply native tool argument preparation once.
- Code and Notebook guidance now separates help discovery from calls using unknown arguments and distinguishes printing from return values.
- TS execution now uses tsrs 0.21.0 with TypeScript 7.1 beta.
- GPT-6.1 Terra, GPT-6 Sol and GPT-6 Luna now support reasoning off.
- Expansion hints now use the configured keybinding.
- Agent guidance now prioritises acting on clear requests without unsolicited deferral.
- Fixed transient Codex transport failures becoming non-retryable after recovery attempts.
- Fixed duplicate voice task submissions from progress updates and repeated handoffs.
- Voice task preparation now preserves captured speech, tone and instructions without adding questions or next steps.
- Voice now recognises conversational wrap-ups and waits for LAN speaker playback before ending calls.
- Fixed stalled short audio tails, playback bursts and duplicated LAN audio. Codex Live now uses Opus packet repair.
- Added content-free connection and playback diagnostics without recording audio.
- Fixed generated task text appearing as user speech.
- LAN Stop now cancels pending task preparation. Herdr Disconnect also closes the listener.
- Added host-side voice settings without starting Pi or a call.
- Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
