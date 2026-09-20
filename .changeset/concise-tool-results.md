---
"@howaboua/pi-codex-conversion": patch
---

Removed redundant completion text and routine command metadata from model-visible tool results.

- Code and Notebook results now return output without a repeated success header. Empty results, errors, running sessions and memory warnings remain explicit.
- Command results omit chunk IDs, elapsed time and unneeded token counts. Truncated output remains marked, and raw JavaScript result fields remain available.
