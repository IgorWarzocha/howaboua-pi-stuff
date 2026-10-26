---
"@howaboua/pi-chatgpt-sites": patch
---

- **BREAKING CHANGE:** Sites results no longer have an outer `result` wrapper. Update saved code to read the returned Sites payload directly.
- Errors show the problem and recovery information without diagnostic envelopes.
