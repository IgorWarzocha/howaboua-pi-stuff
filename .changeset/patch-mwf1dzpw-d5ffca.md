---
"@howaboua/pi-codex-conversion": patch
---

- Tool images now display once across compact, expanded and nested results and respect image visibility settings.
- Image-heavy Code results now keep their previews cached when toggling details.
- Added VM Code with conversation-local JavaScript bindings, top-level `await`, bounded memory and hard cancellation.
- Tool examples now omit mode-specific `await` syntax, with less repeated execution guidance.
- Cache logs now distinguish standing-prompt changes from later instruction updates and locate changed text within 1 KiB blocks without recording prompt contents.
- Added GPT-6.2 Sol and Astra with Responses Lite, live reasoning adjustments and published API-equivalent cost estimates.
- TS mode now uses tsrs 0.25, targeting TypeScript 7.1 beta.
