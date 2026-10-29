---
"@howaboua/pi-codex-conversion": patch
---

- Choose Codex Live, Realtime 2.1 or Realtime 2.1 Mini and model-specific voices in terminal or LAN settings. Codex Live remains the default.
- Realtime models can send tasks to the current Pi session, use developer-registered voice tools and optionally search through Web Run.
- Choose a Pi API provider for Realtime, defaulting to `openai`. Its key and endpoint are used without silently switching accounts.
- Codex Live turns each interval since the previous voice delegation into a self-contained Pi request using a configurable model and reasoning level. Failed preparation is reported in voice without submitting raw input.
- Show the rewritten voice task in session history without adding model context.
- Show the selected startup Voice Context summary even when reused from cache.
- With reasoning-summary forwarding enabled, voice receives completed compatible-model summaries between tools even when the same message has visible text, without replaying streamed text.
- Code and Notebook tools with structured arguments also accept JSON strings and, when help-backed, bare `help`.
- Command-backed custom tools accept objects and arrays directly.
- Keep the selected execution mode and its tools after conversation-tree navigation.
- Guide Code and Notebook models to compose tool calls in one exec without requiring separate cells for help discovery.
