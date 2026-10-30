---
"@howaboua/pi-gippity-control": patch
---

- Guide Realtime voice to avoid repeating ongoing tasks or guessing their results.
- Choose Codex Live, Realtime 2.1 or Realtime 2.1 Mini and model-specific voices in terminal or LAN settings. Codex Live remains the default.
- Realtime models can send tasks to the current Pi session, use developer-registered voice tools and optionally search through Web Run.
- Choose a Pi API provider for Realtime, defaulting to `openai`. Its key and endpoint are used without silently switching accounts.
- Codex Live prepares self-contained Pi requests from recent conversation and authoritative delegation input using a configurable model and reasoning level. Transcript revisions do not block handoff. Failed preparation is reported in voice without submitting raw input.
- Handle voice tasks as ordinary user requests without voice-specific wrappers or reply restrictions, and share progress between tools.
- Show the selected startup Voice Context summary even when reused from cache.
- With reasoning-summary forwarding enabled, voice receives completed compatible-model summaries between tools even when the same message has visible text, without replaying streamed text.
- End voice calls after a farewell without waiting for unrelated Pi work. Public Realtime uses an end-call tool; Codex Live handles ending through its task-preparation agent. Accepted tasks continue after the call closes.
- Transfer LAN voice between sessions on the same machine at the same address; the browser reconnects to a fresh call automatically.
- Retry interrupted LAN voice connections while retaining the microphone where possible.
- Start voice in a local or configured remote browser through `/gippity server connect`, with a correlated listening or failure receipt.
- Inspect or start the LAN listener without toggling it through `/gippity server status|ensure`.
