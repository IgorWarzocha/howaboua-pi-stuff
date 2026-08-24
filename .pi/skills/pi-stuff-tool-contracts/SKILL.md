---
name: pi-stuff-tool-contracts
description: "Read after general agent-tool design when reviewing or changing a model-facing Pi extension tool in this repository."
---

Discover and load applicable general agent tool design guidance before tool work. Load prompt caching guidance too when the active tool vector or system-prompt metadata changes.

Use `scripts/tool-token-lines.mjs` as this repo's preliminary migration and copy-cost probe. If its dependency is absent, install it once:

```bash
(cd .pi/skills/pi-stuff-tool-contracts/scripts && bun install --frozen-lockfile --ignore-scripts)
node .pi/skills/pi-stuff-tool-contracts/scripts/tool-token-lines.mjs <extension-file-or-directory>
```

Add `--json` for machine-readable output. The helper rejects known obsolete TypeBox, Pi package-scope, and removed custom-tool API markers before reporting an o200k token proxy over detected source lines.

The proxy is not the emitted schema or prompt payload. It can miss dynamic strings, imported schemas, conditional modes, and provider serialization. Use it to find likely duplication, then inspect the final registered schemas, prompt metadata, system-prompt additions, and model-visible results for each active mode. Run the owning package's direct check after changes.
