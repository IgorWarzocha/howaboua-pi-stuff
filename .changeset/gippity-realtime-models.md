---
"@howaboua/pi-gippity-control": patch
---

- Choose Codex Live, Realtime 2.1 or Realtime 2.1 Mini and model-specific voices in terminal or LAN settings. Codex Live remains the default.
- Realtime models can send tasks to the current Pi session, use developer-registered voice tools and optionally search through Web Run.
- Choose a Pi API provider for Realtime, defaulting to `openai`. Its key and endpoint are used without silently switching accounts.
- Codex Live turns each interval since the previous voice delegation into a self-contained Pi request using a configurable model and reasoning level. Failed preparation is reported in voice without submitting raw input.
- Handle voice tasks as ordinary user requests without voice-specific wrappers or reply restrictions, and share progress between tools.
- Show the selected startup Voice Context summary even when reused from cache.
- With reasoning-summary forwarding enabled, voice receives completed compatible-model summaries between tools even when the same message has visible text, without replaying streamed text.
