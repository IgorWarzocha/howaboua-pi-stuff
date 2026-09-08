---
"@howaboua/pi-codex-conversion": patch
---

Reduced installation dependencies without removing Notebook or shell-summary features.

- Removed the general ZIP library and Bash grammar package's native install hook.
- Removed the tokenizer dependency and unused encodings while preserving compaction token counts.
- Updated OpenAI, Undici, and the shell parser runtime, including transport security fixes.
