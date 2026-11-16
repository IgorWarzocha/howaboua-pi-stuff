---
"@howaboua/pi-codex-conversion": patch
---

- Tool images now display once across compact, expanded and nested results and respect image visibility settings.
- Image-heavy Code results now keep their previews cached when toggling details.
- Added VM Code with conversation-local JavaScript bindings, including across top-level `await`, bounded memory and hard cancellation. `const`, `var` and function hoisting match a cell without `await`.
- Tool examples now omit mode-specific `await` syntax, with less repeated execution guidance.
