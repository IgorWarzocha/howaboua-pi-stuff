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

The proxy is not the emitted schema or prompt payload. It can miss dynamic strings, imported schemas, conditional modes, and provider serialization. Use it only to locate likely duplication.

## Acceptance gate

- Capture the before-and-after emitted tool schemas and complete tool-related system-prompt additions for every affected active mode, including Structured, Code, and Notebook. Include relevant conditional tool sets and final provider rewrites.
- Inspect the assembled output across extension boundaries. Apply the general tool-design rejection rules to both extension-authored contracts and integration-generated text; fixing one does not excuse the other.
- Record token counts for schemas and prompt additions separately. Show the exact before-and-after artifacts with the change, not just a total or selected source lines.
- Do not accept the change without this evidence. Source proxies, preserved metadata, and passing functional tests are not substitutes. If a mode cannot be captured, report that gap instead of certifying its prompt.

Check model-visible results and run the owning package's direct check after changes.
