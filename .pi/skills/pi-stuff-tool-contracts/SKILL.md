---
name: pi-stuff-tool-contracts
description: "This repo's tool-contract addendum. Read after general tool design when changing model-facing Pi extension tools."
---

Before tool work, discover and load an applicable general tool-design skill. When prompt cost or cache behavior matters, also load an applicable prompt-caching skill.

This repo uses TypeBox 1.x and current `@earendil-works/pi-*` APIs. Migrate obsolete tool shapes instead of preserving compatibility fields.

For model-visible tool changes, inspect the final registered schema and prompt metadata before optimizing copy. Measure this repository's emitted surface with `scripts/tool-token-lines.mjs` when token cost is in scope. Its count is a comparison aid, not a provider payload.

Keep `content` as the model continuation surface. Keep rendering and persistence data in `details`. Preserve the root prompt-cache rules for compact tool contracts and do not rewrite historical tool calls or results merely to integrate a tool.
