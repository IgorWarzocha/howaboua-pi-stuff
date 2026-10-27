---
"@howaboua/pi-chatgpt-sites": patch
---

- Sites calls now return their payload directly instead of an outer `result` wrapper.
- Errors show the problem and recovery information without diagnostic envelopes.
- GPT mode uses note-style guide and schema discovery.
