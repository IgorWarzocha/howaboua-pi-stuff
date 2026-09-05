---
"@howaboua/pi-codex-conversion": patch
---

Preserve Pi tools and prompt when a tool allowlist excludes required Codex adapter tools. Report unavailable tools instead of activating an incomplete adapter.

- Keep excluded Pi tools out of their Code and Notebook projections.
- Refresh tool availability before applying context-window settings.
